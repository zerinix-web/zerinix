import assert from "node:assert/strict";
import test from "node:test";
import { isTurkishReportText, polishTurkishUserFacingOutput } from "../app/lib/report-output-sanitization.ts";
import { sanitizeAiResponseText } from "../app/lib/ai/response-sanitization.ts";
import {
  buildMarketIntelligenceGraph,
  buildMarketIntelligenceBibliography,
} from "../app/lib/ai/market-intelligence-graph.ts";

// Reproduces a real, confirmed production defect: an English-language
// Market Intelligence report analyzing the German market (a completely
// ordinary scenario -- German company names, German-language source
// titles/publishers) had its entire Sources bibliography relabeled into
// Turkish ("Sources" -> "Kaynaklar", every "Confidence:" -> "Güven:")
// purely because German citation titles contain the letters ö/ü (e.g.
// "Bereichsübergreifende Unternehmensstatistik", "...für automatisierten
// Warentransport"). isTurkishReportText's character class treated ö/ü as
// a definite Turkish signal, but they are ordinary German letters --
// German does not use any of Turkish's actually-exclusive letters
// (ç/ğ/ı/ş/İ). This corruption is not cosmetic: it broke every
// "Label: value" line in the deterministic bibliography that
// ReportPdfButton.tsx's parseCitations depends on to render real
// citation cards, producing malformed, unparseable Sources entries.

test("isTurkishReportText: German umlauts alone (ö/ü) do not trigger Turkish detection", () => {
  assert.equal(
    isTurkishReportText("Bereichsübergreifende Unternehmensstatistik"),
    false
  );
  assert.equal(
    isTurkishReportText(
      "Logistikdrohne: Innovatives Modul für automatisierten Warentransport - Fraunhofer IML"
    ),
    false
  );
});

test("isTurkishReportText: genuine Turkish-exclusive letters (ç/ğ/ı/ş/İ) still trigger detection", () => {
  assert.equal(isTurkishReportText("Doğrulama gerekli"), true);
  assert.equal(isTurkishReportText("çalışma"), true);
  assert.equal(isTurkishReportText("İstanbul'da bir şirket"), true);
});

test("isTurkishReportText: the existing Turkish keyword signal is unaffected", () => {
  assert.equal(isTurkishReportText("gayrimenkul yatirim bilgi"), true);
});

test("polishTurkishUserFacingOutput: an English Sources bibliography citing German-language sources is never relabeled into Turkish", () => {
  const bibliography = [
    "Sources",
    "",
    "Reference: [R1]",
    "Title: Logistikdrohne: Innovatives Modul für automatisierten Warentransport - Fraunhofer IML",
    "Publisher: Fraunhofer IML",
    "URL: https://www.iml.fraunhofer.de/de/abteilungen/b1/verpackungs_und_handelslogistik/innovationen/DelivAIRy1.html",
    "Accessed: 2026-08-16",
    "Type: research_institute",
    "Confidence: High",
    "",
    "Reference: [R2]",
    "Title: GENESIS-Online / Bereichsübergreifende Unternehmensstatistik",
    "Publisher: Statistisches Bundesamt (Destatis)",
    "URL: https://genesis.destatis.de/datenbank/online/statistic/42271/table/42271-0004",
    "Accessed: 2026-08-16",
    "Type: government/statistical source",
    "Confidence: High",
  ].join("\n");

  const polished = polishTurkishUserFacingOutput(bibliography);
  assert.equal(polished, bibliography, "an English bibliography with German citations must pass through unchanged");
  assert.ok(polished.startsWith("Sources"), "heading must remain \"Sources\", not \"Kaynaklar\"");
  assert.doesNotMatch(polished, /Güven/);
  assert.doesNotMatch(polished, /Kaynaklar/);
});

test("sanitizeAiResponseText (the exact function serializeNormalizedReportChunk calls before streaming every report field, including Sources) leaves an English German-sourced bibliography intact", () => {
  const bibliography = [
    "Sources",
    "",
    "Reference: [R1]",
    "Title: Logistikdrohne: Innovatives Modul für automatisierten Warentransport - Fraunhofer IML",
    "Publisher: Fraunhofer IML",
    "URL: https://www.iml.fraunhofer.de/de/abteilungen/b1/verpackungs_und_handelslogistik/innovationen/DelivAIRy1.html",
    "Accessed: 2026-08-16",
    "Type: research_institute",
    "Confidence: High",
  ].join("\n");

  const sanitized = sanitizeAiResponseText(bibliography);
  assert.ok(sanitized.startsWith("Sources"), `expected "Sources" heading preserved, got: ${JSON.stringify(sanitized.slice(0, 40))}`);
  assert.match(sanitized, /Confidence: High/);
  assert.doesNotMatch(sanitized, /Güven/);
  assert.doesNotMatch(sanitized, /Kaynaklar/);
});

// End-to-end: the exact live shape (an English report about the German
// market, with real German-language evidence titles/publishers feeding
// buildMarketIntelligenceBibliography) never produces a Turkish-labeled
// bibliography, and every line keeps its recognized "Label:" prefix so
// ReportPdfButton.tsx's parseCitations can parse it correctly.
test("end-to-end: buildMarketIntelligenceBibliography for an English Germany-market report survives sanitizeAiResponseText with no Turkish relabeling", () => {
  const checkedAt = "2026-08-16T00:00:00.000Z";
  const evidence = [
    {
      id: "R1",
      field: "market_size",
      claim: "Fraunhofer IML describes an autonomous drone module for warehouse inventory.",
      value: "Fraunhofer IML drone module overview",
      label: "Verified from external source",
      sourceTitle: "Logistikdrohne: Innovatives Modul für automatisierten Warentransport - Fraunhofer IML",
      publisher: "Fraunhofer IML",
      url: "https://www.iml.fraunhofer.de/de/abteilungen/b1/verpackungs_und_handelslogistik/innovationen/DelivAIRy1.html",
      sourceType: "research_institute",
      authorityLevel: "secondary",
      confidence: 85,
      qualityScore: 85,
      publishedDate: "2026-01-10",
      lastChecked: checkedAt,
      supportingData: ["module overview"],
    },
    {
      id: "R2",
      field: "market_size",
      claim: "Destatis publishes cross-sector enterprise statistics relevant to German logistics.",
      value: "Destatis enterprise statistics",
      label: "Verified from official source",
      sourceTitle: "GENESIS-Online / Bereichsübergreifende Unternehmensstatistik",
      publisher: "Statistisches Bundesamt (Destatis)",
      url: "https://genesis.destatis.de/datenbank/online/statistic/42271/table/42271-0004",
      sourceType: "government/statistical source",
      authorityLevel: "primary",
      confidence: 90,
      qualityScore: 90,
      publishedDate: "2026-01-10",
      lastChecked: checkedAt,
      supportingData: ["enterprise statistics"],
    },
  ];

  const prompt = "Evaluate the commercial opportunity of autonomous warehouse inventory drones for medium and large logistics companies in Germany.";
  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const bibliography = buildMarketIntelligenceBibliography(
    { executiveSummary: "A finding [R1][R2]." },
    graph,
    "English"
  );

  // Sanity: the raw bibliography really does contain German ö/ü text,
  // otherwise this test would not exercise the defect at all.
  assert.match(bibliography, /[öü]/);

  const streamed = sanitizeAiResponseText(bibliography);
  assert.ok(streamed.startsWith("Sources"), `expected the streamed bibliography to keep its English "Sources" heading, got: ${JSON.stringify(streamed.slice(0, 40))}`);
  assert.doesNotMatch(streamed, /Güven/);
  assert.doesNotMatch(streamed, /Kaynaklar/);

  for (const line of streamed.split("\n")) {
    if (!line.trim()) continue;
    assert.match(
      line,
      /^(Sources|Reference:|Title:|Publisher:|URL:|Year:|Accessed:|Type:|Confidence:)/,
      `every non-blank line must keep a recognized "Label:" prefix, got an orphaned/corrupted line: ${JSON.stringify(line)}`
    );
  }
});
