import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createLegalDocumentSummaryFallback,
  legalDocumentSummarySchema,
} from "../app/lib/ai/legal-document-understanding.ts";
import {
  applyDocumentAwareModeOverride,
  classifyAttachmentDocument,
} from "../app/lib/ai/document-intelligence.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

// This is the exact scenario described for the uploaded Yargıtay decision
// image: a criminal appeal/review decision naming defendant Ali Gümüş, an
// acquittal (BERAAT) concerning assistance to premeditated killing, five
// CMK article citations, and a visible page that is cut off mid-sentence
// ("REDDİ, ancak;").
const yargitayDecisionText = `T.C.
YARGITAY
1. CEZA DAİRESİ
ESAS NO: 2021/4455
KARAR NO: 2022/7788

SANIK: Ali Gümüş
SUÇ: Kasten öldürmeye yardım etmek

Yerel Mahkemece verilen hükümde, sanık Ali Gümüş hakkında kasten öldürmeye yardım etmek suçundan kurulan BERAAT kararına yönelik katılan vekilinin temyiz talebinin incelenmesinde;

5271 sayılı CMK'nin 288, 289, 294/2, 298 ve 302/1. maddeleri uyarınca yapılan temyiz incelemesi sonucunda dosya içeriğine göre katılan vekilinin sair temyiz itirazlarının REDDİ, ancak;`;

const yargitayDecisionAsset = {
  name: "yargitay_karari.jpg",
  mimeType: "image/jpeg",
  textContent: yargitayDecisionText,
};

test("the uploaded Yargıtay decision image produces a structured summary matching the exact scenario", () => {
  const summary = createLegalDocumentSummaryFallback({
    assets: [yargitayDecisionAsset],
  });

  assert.equal(legalDocumentSummarySchema.safeParse(summary).success, true);

  assert.match(summary.documentType, /criminal appeal\/review decision/i);
  assert.match(summary.courtOrAuthority, /yargitay/i);

  assert.ok(summary.defendants.includes("Ali Gümüş"));
  assert.ok(summary.parties.includes("Ali Gümüş"));

  const acquittalDecision = summary.decisionsByPerson.find(
    (item) => item.person === "Ali Gümüş"
  );
  assert.ok(acquittalDecision, "expected a decision entry for Ali Gümüş");
  assert.match(acquittalDecision.decision, /beraat/i);
  assert.match(acquittalDecision.decision, /kasten öldürmeye yardım etmek/i);

  const expectedStatutes = ["CMK 288", "CMK 289", "CMK 294/2", "CMK 298", "CMK 302/1"];
  for (const statute of expectedStatutes) {
    assert.ok(
      summary.citedStatutes.includes(statute),
      `expected citedStatutes to include ${statute}, got ${JSON.stringify(summary.citedStatutes)}`
    );
  }

  const truncationNote = summary.unresolvedQuestions.find((item) =>
    /REDDİ, ancak/i.test(item)
  );
  assert.ok(
    truncationNote,
    "expected an unresolved question quoting the page's truncation point"
  );
  assert.match(truncationNote, /cannot be concluded from this page alone/i);
});

test("the Yargıtay summary never invents names, dates, outcomes, or statutes not present in the text", () => {
  const summary = createLegalDocumentSummaryFallback({
    assets: [yargitayDecisionAsset],
  });
  const normalizedSourceText = yargitayDecisionText.replace(/\s+/g, " ");

  assert.equal(summary.complainantsOrParticipants.length, 0);
  assert.equal(summary.defendants.length, 1);
  assert.equal(summary.citedStatutes.length, 5);

  for (const fact of summary.confirmedFacts) {
    const labeledValue = fact.split(/:\s*/).slice(1).join(": ").replace(/^"|"$/g, "");
    assert.ok(
      normalizedSourceText.includes(labeledValue),
      `confirmed fact is not directly supported by the source text: ${fact}`
    );
  }
  for (const claim of summary.disputedClaims) {
    assert.match(claim, /temyiz\s+itiraz/i);
  }
});

test("confirmed facts, party allegations, and court findings are kept in separate fields", () => {
  const summary = createLegalDocumentSummaryFallback({
    assets: [yargitayDecisionAsset],
  });

  assert.ok(summary.confirmedFacts.length > 0);
  assert.ok(summary.disputedClaims.length > 0);
  assert.ok(summary.decisionsByPerson.length > 0);
  assert.ok(
    summary.disputedClaims.every((claim) => !summary.confirmedFacts.includes(claim))
  );
});

test("a partial or low-signal attachment is marked with explicit source limitations instead of being guessed", () => {
  const summary = createLegalDocumentSummaryFallback({
    assets: [{ name: "notes.txt", mimeType: "text/plain", textContent: "" }],
  });

  assert.equal(summary.documentType, "");
  assert.equal(summary.defendants.length, 0);
  assert.equal(summary.citedStatutes.length, 0);
  assert.ok(summary.sourceLimitations.length > 0);
});

test("no attachment produces an empty, schema-valid summary", () => {
  const summary = createLegalDocumentSummaryFallback({ assets: [] });

  assert.equal(legalDocumentSummarySchema.safeParse(summary).success, true);
  assert.deepEqual(summary.defendants, []);
  assert.deepEqual(summary.citedStatutes, []);
  assert.ok(summary.sourceLimitations.length > 0);
});

test("app/api/plan/route.ts generates the legal document summary only when documentCategory is legal_document and analysisType is legal_case_analysis", () => {
  assert.match(
    planRouteSource,
    /documentAwareRouting\.documentCategory === "legal_document" &&\s*\n\s*documentAwareRouting\.analysisType === "legal_case_analysis"/
  );
  assert.match(planRouteSource, /createLegalDocumentSummaryFallback\(/);

  const routingIndex = planRouteSource.indexOf("applyDocumentAwareModeOverride({");
  const summaryIndex = planRouteSource.indexOf("createLegalDocumentSummaryFallback(");
  assert.ok(routingIndex > -1 && summaryIndex > -1);
  assert.ok(routingIndex < summaryIndex);
});

test("legal document understanding does not touch business, market, finance, real-estate, billing, or PDF logic", () => {
  // Scoped to the legal-document-understanding layer's own statements
  // (isLegalCaseAnalysis through the body.documentIntelligence assignment),
  // not the whole file -- route.ts legitimately imports from
  // app/lib/report-engine/domain elsewhere (readRequestExpertiseProfile
  // uses classifyReportDomain to seed its own domain fallback), which is
  // unrelated to this layer and not business/market/finance/real-estate/
  // billing/PDF logic.
  const startIndex = planRouteSource.indexOf("const isLegalCaseAnalysis =");
  const endMarker = "...(legalCaseAnalysis ? { legalCaseAnalysis } : {}),";
  const endIndex = planRouteSource.indexOf(endMarker, startIndex) + endMarker.length;
  const statementSource = planRouteSource.slice(startIndex, endIndex);

  assert.ok(startIndex > -1 && endIndex > startIndex);

  const forbiddenPaths = [
    "app/lib/pdf-engine",
    "app/lib/report-engine",
    "app/lib/billing",
    "app/lib/ai/market-analysis",
    "app/lib/ai/adaptive-report-writer",
    "app/lib/decision-intelligence/legal-research-context",
  ];

  for (const path of forbiddenPaths) {
    assert.doesNotMatch(statementSource, new RegExp(path.replace(/\//g, "\\/")));
  }
});

test("end to end: the exact routing + summarization pipeline for the Yargıtay attachment never selects Business Idea Validation or Market Intelligence", () => {
  const classification = classifyAttachmentDocument({
    assets: [yargitayDecisionAsset],
  });
  const routing = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification,
  });
  const summary =
    routing.documentCategory === "legal_document" &&
    routing.analysisType === "legal_case_analysis"
      ? createLegalDocumentSummaryFallback({ assets: [yargitayDecisionAsset] })
      : null;

  assert.equal(routing.selectedMode, "chat");
  assert.notEqual(routing.selectedMode, "plan");
  assert.notEqual(routing.selectedMode, "market");
  assert.ok(summary, "expected a structured legal document summary to be generated");
  assert.ok(summary.defendants.includes("Ali Gümüş"));
});
