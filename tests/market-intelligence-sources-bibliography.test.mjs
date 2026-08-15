import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
  buildMarketIntelligenceBibliography,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { assertNoOrphanEvidenceReferences } from "../app/lib/report-engine/evidence-reference-integrity.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// executive-quality-gate.ts has one real "@/"-aliased import, so plain
// `node --test` can't resolve it directly. Same alias-rewrite technique
// already established in tests/executive-decision-pipeline.test.mjs:
// rewrite that one specifier to an absolute file:// path and import the
// result from a throwaway temp file -- real functional coverage, no
// persisted scratch script.
async function importExecutiveQualityGate() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/executive-quality-gate.ts");
  const fillerDetectionPath = join(repoRoot, "app/lib/report-engine/filler-detection.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/filler-detection"',
    JSON.stringify(pathToFileURL(fillerDetectionPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-mi-sources-eqg-"));
  const outPath = join(dir, "executive-quality-gate.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { runExecutiveQualityGate } = await importExecutiveQualityGate();

// Production-quality Sources system: the Sources section must become a
// complete, deterministic bibliography (built directly from the verified
// evidence registry) instead of a lossy "Evidence Summary" category+count
// compression -- every [R#] cited anywhere in the report must resolve to a
// real, fully-detailed entry.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name = "Acme Corp", domain = "acme.com", url }) {
  return {
    id,
    field: "market_size",
    claim: `${name} reports figures relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
    sourceTitle: `${name} market report`,
    publisher: name,
    url: url ?? `https://${domain}/report`,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

test("1. multiple report sections citing the same source produce exactly one bibliography entry", () => {
  const evidence = [evidenceItem({ id: "R1" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const sections = {
    executiveSummary: "Demand is rising across the region [R1].",
    marketOverview: "The same source also covers category scope [R1].",
    threats: "Risk factors are limited [R1].",
  };
  const bibliography = buildMarketIntelligenceBibliography(sections, graph, "English");
  const referenceLines = bibliography.split("\n").filter((line) => line.startsWith("Reference:"));
  assert.equal(referenceLines.length, 1, "R1 cited 3 times must still produce exactly one entry");
  assert.equal(referenceLines[0], "Reference: [R1]");
});

test("2. two different evidence IDs pointing at the same canonical URL merge into one reference, tagged with both IDs", () => {
  const evidence = [
    evidenceItem({ id: "R1", url: "https://acme.com/report?utm_source=google" }),
    evidenceItem({ id: "R7", url: "https://acme.com/report" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const sections = {
    executiveSummary: "First mention [R1].",
    opportunities: "Second mention of the same underlying document [R7].",
  };
  const bibliography = buildMarketIntelligenceBibliography(sections, graph, "English");
  const referenceLines = bibliography.split("\n").filter((line) => line.startsWith("Reference:"));
  assert.equal(referenceLines.length, 1, "duplicate-URL sources must merge into a single entry");
  assert.match(referenceLines[0], /\[R1\]/);
  assert.match(referenceLines[0], /\[R7\]/);
});

test("3. an evidence item with no valid URL never becomes a citable or resolvable source", () => {
  const evidence = [
    evidenceItem({ id: "R1" }),
    { ...evidenceItem({ id: "R2" }), url: "not-a-valid-url" },
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  assert.ok(graph.citableEvidenceIds.has("R1"));
  assert.ok(!graph.citableEvidenceIds.has("R2"), "an evidence item with no valid URL must never be citable");
  assert.equal(graph.sourceRecordByEvidenceId.R2, undefined);

  // Confirms the integrity gate actually catches a citation to it, rather
  // than silently rendering a broken/placeholder entry.
  assert.throws(() =>
    assertNoOrphanEvidenceReferences(
      { threats: "A claim citing the invalid-URL item [R2]." },
      graph.citableEvidenceIds
    )
  );
});

test("4. bibliography reference numbering exactly matches first-appearance order of in-text citations", () => {
  const evidence = [
    evidenceItem({ id: "R5", name: "Beta Inc", domain: "beta.com" }),
    evidenceItem({ id: "R2", name: "Gamma LLC", domain: "gamma.com" }),
    evidenceItem({ id: "R9", name: "Delta Co", domain: "delta.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const sections = {
    executiveSummary: "Opening claim [R9].",
    marketOverview: "Second claim [R5], then a third [R2].",
  };
  const bibliography = buildMarketIntelligenceBibliography(sections, graph, "English");
  const referenceLines = bibliography.split("\n").filter((line) => line.startsWith("Reference:"));
  assert.deepEqual(referenceLines, ["Reference: [R9]", "Reference: [R5]", "Reference: [R2]"]);
});

test("5a. bibliography entries include every required field when available (Publisher, Title, URL, Year, Accessed, Type, Confidence)", () => {
  const evidence = [evidenceItem({ id: "R1", name: "Reuters", domain: "reuters.com" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const bibliography = buildMarketIntelligenceBibliography(
    { executiveSummary: "A finding [R1]." },
    graph,
    "English"
  );
  assert.match(bibliography, /Reference: \[R1\]/);
  assert.match(bibliography, /Title: Reuters market report/);
  assert.match(bibliography, /Publisher: Reuters/);
  assert.match(bibliography, /URL: https:\/\/reuters\.com\/report/);
  assert.match(bibliography, /Year: 2026/);
  assert.match(bibliography, /Accessed: \d{4}-\d{2}-\d{2}/);
  assert.match(bibliography, /Type: market research/);
  assert.match(bibliography, /Confidence: (High|Medium|Low)/);
});

test("5b. never collapses to a single meaningless row or placeholder text for a multi-source report", () => {
  const evidence = [
    evidenceItem({ id: "R1", name: "Reuters", domain: "reuters.com" }),
    evidenceItem({ id: "R2", name: "Bloomberg", domain: "bloomberg.com" }),
    evidenceItem({ id: "R3", name: "Forrester", domain: "forrester.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const sections = {
    executiveSummary: "One [R1].",
    marketOverview: "Two [R2].",
    threats: "Three [R3].",
  };
  const bibliography = buildMarketIntelligenceBibliography(sections, graph, "English");
  const referenceLines = bibliography.split("\n").filter((line) => line.startsWith("Reference:"));
  assert.equal(referenceLines.length, 3);
  assert.doesNotMatch(bibliography, /placeholder|not specified|not provided/i);
});

test("5c. zero citations anywhere produces an honest, explicit notice, never a fabricated entry", () => {
  const evidence = [evidenceItem({ id: "R1" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const bibliography = buildMarketIntelligenceBibliography(
    { executiveSummary: "No citations used anywhere in this text." },
    graph,
    "English"
  );
  assert.doesNotMatch(bibliography, /Reference:/);
  assert.match(bibliography, /No independently verifiable sources/i);
});

test("6a. PDF rendering: the deterministic bibliography format is parsed by ReportPdfButton.tsx's parseCitations into complete citation cards (mirrored parser logic)", () => {
  // Mirrors parseCitations's metadata-line handling exactly (including
  // this session's Reference:/Accessed: additions), without importing a
  // browser-only "use client" .tsx module into a Node test.
  const citationProseVerbPattern =
    /\b(?:is|are|was|were|outweighs|remains|requires|means|shows|reflects|confidence)\b/i;
  function looksLikeCitationMetadataValue(value, maxWords = 18) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 140) return false;
    if (trimmed.split(/\s+/).length > maxWords) return false;
    if (/[.!?]/.test(trimmed)) return false;
    if (citationProseVerbPattern.test(trimmed)) return false;
    return true;
  }

  function parseBlock(block) {
    const current = {};
    for (const rawLine of block.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      const metadataMatch = line.match(
        /^(title|source|publisher|organization|year|publication year|url|confidence|source type|type|reference|accessed|access date)\s*[:\-–—]\s*(.+)$/i
      );
      if (!metadataMatch) continue;
      const key = metadataMatch[1].toLowerCase();
      const value = metadataMatch[2].trim();
      if (key === "title" || key === "source") {
        if (looksLikeCitationMetadataValue(value, 24)) current.sourceTitle = value;
      } else if (key === "publisher" || key === "organization") {
        if (looksLikeCitationMetadataValue(value)) current.organization = value;
      } else if (key === "year" || key === "publication year") {
        current.publicationYear = value.match(/\b(19|20)\d{2}\b/)?.[0];
      } else if (key === "url") {
        current.url = value;
      } else if (key === "confidence") {
        current.confidence = value;
      } else if (key === "reference") {
        current.referenceTag = value;
      } else if (key === "accessed" || key === "access date") {
        if (looksLikeCitationMetadataValue(value)) current.accessDate = value;
      } else if (looksLikeCitationMetadataValue(value)) {
        current.sourceType = value;
      }
    }
    return current;
  }

  const evidence = [evidenceItem({ id: "R1", name: "Reuters", domain: "reuters.com" })];
  const graph = buildMarketIntelligenceGraph({ evidence }, "market report");
  const bibliography = buildMarketIntelligenceBibliography(
    { executiveSummary: "A finding [R1]." },
    graph,
    "English"
  );
  const block = bibliography.split("\n\n").find((b) => b.includes("Reference:"));
  const parsed = parseBlock(block);
  assert.equal(parsed.referenceTag, "[R1]");
  assert.equal(parsed.sourceTitle, "Reuters market report");
  assert.equal(parsed.organization, "Reuters");
  assert.equal(parsed.url, "https://reuters.com/report");
  assert.equal(parsed.publicationYear, "2026");
  assert.ok(parsed.accessDate);
});

test("6b. ReportPdfButton.tsx defines Reference:/Accessed: parsing and renders the reference tag on each Sources bullet", () => {
  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.match(
    pdfButtonSource,
    /reference\|accessed\|access date/,
    "parseCitations must recognize the new Reference:/Accessed: metadata keys"
  );
  assert.match(pdfButtonSource, /referenceTag\?: string/);
  assert.match(pdfButtonSource, /accessDate\?: string/);
  assert.match(
    pdfButtonSource,
    /source\.referenceTag \? `\$\{source\.referenceTag\} ` : ""/,
    "the Sources bullet must be prefixed with the resolved [R#] tag(s)"
  );
});

test("7. cross-report isolation: a bibliography built from report B's graph never resolves report A's evidence IDs", () => {
  const reportAEvidence = [evidenceItem({ id: "R1", name: "Report A Source", domain: "report-a-source.com" })];
  const reportBEvidence = [evidenceItem({ id: "R1", name: "Report B Source", domain: "report-b-source.com" })];

  const graphA = buildMarketIntelligenceGraph({ evidence: reportAEvidence }, "market report A");
  const graphB = buildMarketIntelligenceGraph({ evidence: reportBEvidence }, "market report B");

  // Report B's own sections, correctly built against report B's own graph.
  const bibliographyB = buildMarketIntelligenceBibliography(
    { executiveSummary: "A finding [R1]." },
    graphB,
    "English"
  );
  assert.match(bibliographyB, /Report B Source/);
  assert.doesNotMatch(bibliographyB, /Report A Source/, "report A's source must never leak into report B's bibliography");

  // Sanity: the two graphs' registries are independent objects, not a
  // shared/global registry that could cross-contaminate.
  assert.notEqual(graphA.sourceRecordByEvidenceId.R1, graphB.sourceRecordByEvidenceId.R1);
  assert.equal(graphA.sourceRecordByEvidenceId.R1.publisher, "Report A Source");
  assert.equal(graphB.sourceRecordByEvidenceId.R1.publisher, "Report B Source");
});

test("8. the quality gate's raw-URL ceiling exempts unboundedSourceFields entirely, unlike sourceFields (still capped at 3)", () => {
  const manySources = Array.from({ length: 10 }, (_, i) => `URL: https://source${i}.com`).join("\n");

  const uncapped = runExecutiveQualityGate({
    sections: { executiveSummary: "Decision: GO (confidence 70%).", sources: manySources },
    firstField: "executiveSummary",
    sourceFields: ["sources"],
    unboundedSourceFields: ["sources"],
  });
  assert.ok(
    !uncapped.some((failure) => failure.check === "no_long_source_lists"),
    "a field in unboundedSourceFields must never trip the raw-URL ceiling"
  );

  const stillCapped = runExecutiveQualityGate({
    sections: { executiveSummary: "Decision: GO (confidence 70%).", sources: manySources },
    firstField: "executiveSummary",
    sourceFields: ["sources"],
    // unboundedSourceFields intentionally omitted -- must behave exactly
    // as before this change (still capped at MAX_RAW_URLS_PER_FIELD).
  });
  assert.ok(
    stillCapped.some((failure) => failure.check === "no_long_source_lists"),
    "without unboundedSourceFields, a source field with 10 raw URLs must still trip the existing cap (unchanged behavior)"
  );
});

test("9. the quality gate's report-wide filler ceiling never flags a bibliography's legitimately repeated structural fields (Type:/Confidence:) as duplicate prose", () => {
  // A realistic bibliography where many entries share the same Type and
  // Confidence values (correct -- they really are all "market research" /
  // "High") alongside enough narrative body text elsewhere to make the
  // scenario realistic.
  const bibliography = Array.from({ length: 8 }, (_, i) =>
    [
      `Reference: [R${i + 1}]`,
      `Title: Source number ${i + 1} report on the analyzed market`,
      `Publisher: Publisher ${i + 1}`,
      `URL: https://source${i + 1}.example.com/report`,
      "Type: market research",
      "Confidence: High",
    ].join("\n")
  ).join("\n\n");

  const narrativeField =
    "This is a substantive, non-repeated narrative paragraph describing the market opportunity in enough detail to read as genuine executive analysis rather than filler.";

  const withoutExemption = runExecutiveQualityGate({
    sections: {
      executiveSummary: "Decision: GO (confidence 70%).",
      marketOverview: narrativeField,
      sources: bibliography,
    },
    firstField: "executiveSummary",
    sourceFields: ["sources"],
  });
  assert.ok(
    withoutExemption.some((failure) => failure.check === "filler_ceiling"),
    "sanity check: without the exemption, the repeated structural fields really do trip the ceiling"
  );

  const withExemption = runExecutiveQualityGate({
    sections: {
      executiveSummary: "Decision: GO (confidence 70%).",
      marketOverview: narrativeField,
      sources: bibliography,
    },
    firstField: "executiveSummary",
    sourceFields: ["sources"],
    unboundedSourceFields: ["sources"],
  });
  assert.ok(
    !withExemption.some((failure) => failure.check === "filler_ceiling"),
    "unboundedSourceFields must exclude the bibliography from the report-wide filler/duplicate-sentence scan"
  );
});
