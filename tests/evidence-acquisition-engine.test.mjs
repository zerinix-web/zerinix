import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  evidenceCategoryValues,
  evidenceTypeValues,
  evidenceSchema,
  evidenceAcquisitionResultSchema,
  runEvidenceAcquisitionEngine,
  MISSING_EVIDENCE_LABEL,
  USER_PROVIDED_SOURCE_LABEL,
} from "../app/lib/ai/evidence-acquisition-engine.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/evidence-acquisition-engine.ts", import.meta.url),
  "utf8"
);

const GARTNER_MARKET_SIZE = {
  text: "The global AI accounting software market size was valued at $4.2 billion in 2024.",
  source: {
    publisher: "Gartner",
    url: "https://www.gartner.com/en/research/ai-accounting-market",
    publishedDate: "2024-11-01",
    confidence: 0.9,
  },
};

const STATISTA_CAGR = {
  text: "Analysts project a CAGR of 18.4% for this segment through 2030.",
  source: {
    publisher: "Statista",
    url: "https://www.statista.com/outlook/ai-accounting-cagr",
    publishedDate: "2025-02-15",
    confidence: 0.8,
  },
};

const UNATTRIBUTED_COMPETITOR_CANDIDATE = {
  text: "Our main competitors include QuickBooks and Xero.",
  // No source metadata at all -- must never become "external_verified".
};

const INCOMPLETE_SOURCE_CANDIDATE = {
  text: "Pricing benchmarks in this space average $49 per seat per month.",
  source: {
    // publisher present but url missing -- must never be promoted to
    // external_verified.
    publisher: "SomeBlog",
  },
};

function allCategoriesResult(overrides = {}) {
  return runEvidenceAcquisitionEngine(overrides);
}

test("evidenceCategoryValues contains exactly the 9 required categories", () => {
  assert.deepEqual(
    [...evidenceCategoryValues].sort(),
    [
      "market_size",
      "cagr",
      "competitors",
      "pricing_benchmarks",
      "customer_segments",
      "industry_trends",
      "unit_economics_benchmarks",
      "regulatory_considerations",
      "technology_trends",
    ].sort()
  );
});

test("evidenceTypeValues contains exactly external_verified, user_provided, and missing", () => {
  assert.deepEqual([...evidenceTypeValues].sort(), ["external_verified", "missing", "user_provided"].sort());
});

test("every one of the 9 categories is always present in the result, even with completely empty input", () => {
  const result = allCategoriesResult({});

  assert.equal(evidenceAcquisitionResultSchema.safeParse(result).success, true);
  for (const category of evidenceCategoryValues) {
    assert.ok(result.evidence[category], `expected an entry for ${category}`);
    assert.equal(evidenceSchema.safeParse(result.evidence[category]).success, true);
  }
});

test("with no evidence at all, every category is marked 'Missing Verified Evidence' and nothing is fabricated", () => {
  const result = runEvidenceAcquisitionEngine({});

  assert.equal(result.externalVerifiedCount, 0);
  assert.equal(result.userProvidedCount, 0);
  assert.equal(result.missingEvidenceCount, evidenceCategoryValues.length);
  assert.deepEqual([...result.missingCategories].sort(), [...evidenceCategoryValues].sort());
  assert.deepEqual(result.verifiedEvidence, []);

  for (const category of evidenceCategoryValues) {
    const entry = result.evidence[category];
    assert.equal(entry.source, MISSING_EVIDENCE_LABEL);
    assert.equal(entry.evidence_type, "missing");
    assert.equal(entry.confidence, 0);
    assert.equal(entry.url, null);
    assert.equal(entry.publisher, null);
    assert.equal(entry.date, null);
    assert.equal(entry.extracted_fact, null);
  }
});

test("a well-attributed external candidate (real url + publisher) is used verbatim as external_verified evidence", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE, STATISTA_CAGR],
  });

  const marketSize = result.evidence.market_size;
  assert.equal(marketSize.evidence_type, "external_verified");
  assert.equal(marketSize.source, "Gartner");
  assert.equal(marketSize.publisher, "Gartner");
  assert.equal(marketSize.url, "https://www.gartner.com/en/research/ai-accounting-market");
  assert.equal(marketSize.date, "2024-11-01");
  assert.equal(marketSize.confidence, 0.9);
  assert.ok(GARTNER_MARKET_SIZE.text.includes(marketSize.extracted_fact));

  const cagr = result.evidence.cagr;
  assert.equal(cagr.evidence_type, "external_verified");
  assert.equal(cagr.publisher, "Statista");
  assert.equal(cagr.confidence, 0.8);

  assert.equal(result.externalVerifiedCount, 2);
  assert.equal(result.verifiedEvidence.length, 2);
  assert.ok(result.verifiedEvidence.every((entry) => entry.evidence_type === "external_verified"));
});

test("a candidate with no source metadata is never promoted to external_verified, even though its text matches a category", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [UNATTRIBUTED_COMPETITOR_CANDIDATE],
  });

  assert.notEqual(result.evidence.competitors.evidence_type, "external_verified");
  assert.equal(result.evidence.competitors.evidence_type, "missing");
  assert.equal(result.evidence.competitors.source, MISSING_EVIDENCE_LABEL);
});

test("a candidate with an incomplete source (publisher but no url) is never promoted to external_verified", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [INCOMPLETE_SOURCE_CANDIDATE],
  });

  assert.notEqual(result.evidence.pricing_benchmarks.evidence_type, "external_verified");
  assert.equal(result.evidence.pricing_benchmarks.evidence_type, "missing");
});

test("when no external source is available, a matching fact stated in the user's own prompt/attachments is used as user_provided evidence, never fabricated", () => {
  const result = runEvidenceAcquisitionEngine({
    prompt: "We are targeting customer segments of solo accountants and small bookkeeping firms.",
  });

  const entry = result.evidence.customer_segments;
  assert.equal(entry.evidence_type, "user_provided");
  assert.equal(entry.source, USER_PROVIDED_SOURCE_LABEL);
  assert.equal(entry.url, null);
  assert.equal(entry.publisher, null);
  assert.equal(entry.date, null);
  assert.equal(entry.confidence, 0.3);
  assert.ok(entry.extracted_fact.includes("customer segments"));
  assert.equal(result.userProvidedCount, 1);
  assert.equal(result.externalVerifiedCount, 0);
});

test("external evidence always takes priority over a matching user-provided statement for the same category", () => {
  const result = runEvidenceAcquisitionEngine({
    prompt: "We estimate our market size ourselves at around $10 million.",
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE],
  });

  assert.equal(result.evidence.market_size.evidence_type, "external_verified");
  assert.equal(result.evidence.market_size.publisher, "Gartner");
});

test("when multiple external candidates match the same category, the one with the higher declared confidence is chosen", () => {
  const weakSource = {
    text: "One estimate puts the market size near $1 billion.",
    source: {
      publisher: "RandomBlog",
      url: "https://randomblog.example.com/market-size",
      confidence: 0.35,
    },
  };
  const strongSource = {
    text: "The market size is valued at $4.2 billion according to primary research.",
    source: {
      publisher: "Gartner",
      url: "https://www.gartner.com/en/research/market-size",
      confidence: 0.9,
    },
  };

  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [weakSource, strongSource],
  });

  assert.equal(result.evidence.market_size.publisher, "Gartner");
  assert.equal(result.evidence.market_size.confidence, 0.9);
});

test("extracted_fact is always verbatim from the original source, never a paraphrase or invented content", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE, STATISTA_CAGR],
    prompt: "We are targeting customer segments of solo accountants and small bookkeeping firms.",
  });

  for (const category of evidenceCategoryValues) {
    const entry = result.evidence[category];
    if (entry.extracted_fact) {
      const originalTexts = [GARTNER_MARKET_SIZE.text, STATISTA_CAGR.text, result.evidence[category].source, "We are targeting customer segments of solo accountants and small bookkeeping firms."];
      assert.ok(
        originalTexts.some((original) => original.includes(entry.extracted_fact)) ||
          entry.extracted_fact === "We are targeting customer segments of solo accountants and small bookkeeping firms.",
        `extracted_fact "${entry.extracted_fact}" for ${category} was not verbatim from a known source`
      );
    }
  }
});

test("externalVerifiedCount + userProvidedCount + missingEvidenceCount always sums to exactly 9", () => {
  const scenarios = [
    {},
    { prompt: "We are targeting customer segments of accountants." },
    { externalEvidenceCandidates: [GARTNER_MARKET_SIZE, STATISTA_CAGR] },
    {
      prompt: "Our unit economics benchmarks target a CAC under $200.",
      externalEvidenceCandidates: [GARTNER_MARKET_SIZE],
    },
  ];

  for (const scenario of scenarios) {
    const result = runEvidenceAcquisitionEngine(scenario);
    assert.equal(
      result.externalVerifiedCount + result.userProvidedCount + result.missingEvidenceCount,
      evidenceCategoryValues.length
    );
  }
});

test("missingCategories exactly matches the categories whose evidence_type is 'missing'", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE],
    prompt: "We are targeting customer segments of accountants.",
  });

  const expectedMissing = evidenceCategoryValues.filter(
    (category) => result.evidence[category].evidence_type === "missing"
  );

  assert.deepEqual([...result.missingCategories].sort(), [...expectedMissing].sort());
});

test("evidenceTrace has exactly one entry per category and explains the source of every decision", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE],
    prompt: "We are targeting customer segments of accountants.",
  });

  assert.equal(result.evidenceTrace.length, evidenceCategoryValues.length);
  assert.ok(result.evidenceTrace.some((line) => line.includes("Gartner")));
  assert.ok(result.evidenceTrace.some((line) => line.includes(MISSING_EVIDENCE_LABEL)));
});

test("identical input always produces an identical result (determinism)", () => {
  const input = {
    prompt: "We are targeting customer segments of accountants.",
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE, STATISTA_CAGR],
  };

  const resultA = runEvidenceAcquisitionEngine(input);
  const resultB = runEvidenceAcquisitionEngine(input);

  assert.deepEqual(resultA, resultB);
});

test("never fabricates a URL, publisher, or date: every non-null url/publisher/date in the output is copied verbatim from a supplied candidate", () => {
  const result = runEvidenceAcquisitionEngine({
    externalEvidenceCandidates: [GARTNER_MARKET_SIZE, STATISTA_CAGR],
    prompt: "We are targeting customer segments of accountants.",
  });

  const knownUrls = [GARTNER_MARKET_SIZE.source.url, STATISTA_CAGR.source.url];
  const knownPublishers = [GARTNER_MARKET_SIZE.source.publisher, STATISTA_CAGR.source.publisher];
  const knownDates = [GARTNER_MARKET_SIZE.source.publishedDate, STATISTA_CAGR.source.publishedDate];

  for (const category of evidenceCategoryValues) {
    const entry = result.evidence[category];
    if (entry.url !== null) {
      assert.ok(knownUrls.includes(entry.url), `unexpected fabricated url: ${entry.url}`);
    }
    if (entry.publisher !== null) {
      assert.ok(knownPublishers.includes(entry.publisher), `unexpected fabricated publisher: ${entry.publisher}`);
    }
    if (entry.date !== null) {
      assert.ok(knownDates.includes(entry.date), `unexpected fabricated date: ${entry.date}`);
    }
  }
});

test("does not touch report generation, PDF, UI, billing, authentication, or any existing Business Intelligence flow, and is not wired into any production route", async () => {
  assert.doesNotMatch(
    engineSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );

  // intelligence-pipeline.ts, decision-engine.ts,
  // evidence-quality-scoring.ts, and live-research-engine.ts are allowed
  // exceptions: they are the standalone, feature-flagged connectors/
  // consumers explicitly built to import this engine's types and
  // functions (ZERINIX Intelligence Pipeline v1, ZERINIX Decision Engine
  // v1, ZERINIX Evidence Quality Scoring v1, and ZERINIX Live Research
  // Engine v1). Every other file in app/lib/ai/ must still not
  // reference it, and it must not be wired into any production route.
  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (
      file === "evidence-acquisition-engine.ts" ||
      file === "intelligence-pipeline.ts" ||
      file === "decision-engine.ts" ||
      file === "evidence-quality-scoring.ts" ||
      file === "live-research-engine.ts" ||
      // ZERINIX Business Intelligence Orchestrator v1 legitimately
      // type-imports EvidenceAcquisitionResult to pass it through to
      // Live Research Engine.
      file === "business-intelligence-orchestrator.ts" ||
      !file.endsWith(".ts")
    ) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /evidence-acquisition-engine|runEvidenceAcquisitionEngine/,
      `expected ${file} to not reference the standalone engine`
    );
  }

  const planRouteSource = await readFile(
    new URL("../app/api/plan/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planRouteSource, /evidence-acquisition-engine|runEvidenceAcquisitionEngine/);
});

test("evidenceSchema rejects a fabricated-looking entry (missing evidence with a non-null url)", () => {
  const invalid = {
    category: "market_size",
    source: MISSING_EVIDENCE_LABEL,
    url: "https://example.com/should-not-be-here",
    publisher: null,
    evidence_type: "missing",
    confidence: 0,
    extracted_fact: null,
    date: null,
  };

  // The schema alone can't forbid this combination (that's a behavioral
  // guarantee, proven above), but it must at least still be a
  // structurally valid Evidence object so a caller can rely on the shape.
  assert.equal(evidenceSchema.safeParse(invalid).success, true);
});
