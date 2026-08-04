import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createLegalDocumentSummaryFallback,
  normalizeForMatch,
} from "../app/lib/ai/legal-document-understanding.ts";
import {
  createLegalCaseAnalysis,
  legalCaseAnalysisSchema,
  statementLabelValues,
} from "../app/lib/ai/legal-case-analysis.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

// The exact uploaded Yargıtay decision scenario, extended with a second,
// undecided co-defendant so "analyze each named defendant separately" and
// "lists the other named defendants separately" are genuinely exercised
// rather than trivially true for a single-defendant document.
const yargitayDecisionText = `T.C.
YARGITAY
1. CEZA DAİRESİ
ESAS NO: 2021/4455
KARAR NO: 2022/7788

SANIK: Ali Gümüş
SANIK: Mehmet Kaya
SUÇ: Kasten öldürmeye yardım etmek

Yerel Mahkemece verilen hükümde, sanık Ali Gümüş hakkında kasten öldürmeye yardım etmek suçundan kurulan BERAAT kararına yönelik katılan vekilinin temyiz talebinin incelenmesinde;

5271 sayılı CMK'nin 288, 289, 294/2, 298 ve 302/1. maddeleri uyarınca yapılan temyiz incelemesi sonucunda dosya içeriğine göre katılan vekilinin sair temyiz itirazlarının REDDİ, ancak;`;

const yargitayDecisionAsset = {
  name: "yargitay_karari.jpg",
  mimeType: "image/jpeg",
  textContent: yargitayDecisionText,
};

function buildAnalysis() {
  const summary = createLegalDocumentSummaryFallback({
    assets: [yargitayDecisionAsset],
  });
  return createLegalCaseAnalysis(summary);
}

test("the analysis is schema-valid and every statement carries one of the four required labels", () => {
  const analysis = buildAnalysis();
  assert.equal(legalCaseAnalysisSchema.safeParse(analysis).success, true);

  const allStatements = [
    ...analysis.caseSummary,
    ...analysis.proceduralPosture,
    ...analysis.personByPersonOutcome.flatMap((item) => item.statements),
    ...analysis.courtReasoning,
    ...analysis.appealArguments,
    ...analysis.acceptedArguments,
    ...analysis.rejectedArguments,
    ...analysis.evidenceAssessment,
    ...analysis.legalIssues,
    ...analysis.inconsistencies,
    ...analysis.strengths,
    ...analysis.weaknesses,
    ...analysis.unresolvedIssues,
    ...analysis.practicalNextSteps,
    ...analysis.confidenceAndLimitations,
  ];
  assert.ok(allStatements.length > 0);
  for (const statement of allStatements) {
    assert.ok(statementLabelValues.includes(statement.label));
  }
});

test("Ali Gümüş is identified separately and his acquittal is recorded as upheld on the visible page", () => {
  const analysis = buildAnalysis();
  const aliOutcome = analysis.personByPersonOutcome.find(
    (item) => item.person === "Ali Gümüş"
  );

  assert.ok(aliOutcome, "expected a separate personByPersonOutcome entry for Ali Gümüş");

  const combinedText = aliOutcome.statements.map((item) => item.text).join(" ");
  assert.match(combinedText, /beraat/i);
  assert.match(combinedText, /kasten öldürmeye yardım etmek/i);
  assert.match(combinedText, /upheld/i);

  const inferenceStatement = aliOutcome.statements.find(
    (item) => item.label === "Model Inference" && /upheld/i.test(item.text)
  );
  assert.ok(
    inferenceStatement,
    "the 'upheld' conclusion must be labeled Model Inference, not presented as a confirmed fact"
  );
});

test("the other named defendant is listed separately with no invented outcome", () => {
  const analysis = buildAnalysis();
  const mehmetOutcome = analysis.personByPersonOutcome.find(
    (item) => item.person === "Mehmet Kaya"
  );

  assert.ok(mehmetOutcome, "expected a separate personByPersonOutcome entry for Mehmet Kaya");
  assert.ok(
    mehmetOutcome.statements.every((item) => !/beraat|mahkumiyet|hüküm/i.test(item.text)),
    "no outcome should be invented for Mehmet Kaya"
  );
  assert.match(
    mehmetOutcome.statements.map((item) => item.text).join(" "),
    /No outcome/i
  );
});

test("defense/appellant arguments are distinguished from the court's rejection of those arguments", () => {
  const analysis = buildAnalysis();

  assert.ok(analysis.appealArguments.length > 0);
  assert.ok(analysis.appealArguments.every((item) => item.label === "Party Argument"));

  assert.ok(analysis.rejectedArguments.length > 0);
  assert.ok(analysis.rejectedArguments.every((item) => item.label === "Court Finding"));
  assert.ok(
    analysis.rejectedArguments.some((item) => /reddi/.test(normalizeForMatch(item.text)))
  );

  const acceptedText = normalizeForMatch(
    analysis.acceptedArguments.map((item) => item.text).join(" ")
  );
  assert.doesNotMatch(acceptedText, /reddi/);
});

test("cites CMK 288, 289, 294/2, 298 and 302/1", () => {
  const analysis = buildAnalysis();
  const legalIssuesText = analysis.legalIssues.map((item) => item.text).join(" ");

  for (const statute of ["CMK 288", "CMK 289", "CMK 294/2", "CMK 298", "CMK 302/1"]) {
    assert.match(legalIssuesText, new RegExp(statute.replace("/", "\\/")));
  }
});

test('warns that the final result after "REDDİ, ancak;" is not visible', () => {
  const analysis = buildAnalysis();
  const allText = normalizeForMatch(
    [
      ...analysis.proceduralPosture,
      ...analysis.unresolvedIssues,
      ...analysis.personByPersonOutcome.flatMap((item) => item.statements),
    ]
      .map((item) => item.text)
      .join(" ")
  );

  assert.match(allText, /reddi,?\s*ancak/);
  assert.match(allText, /cannot be (?:concluded|determined)/);
});

test("never presents a success probability, reversal probability, or definitive legal advice", () => {
  const analysis = buildAnalysis();
  const allText = JSON.stringify(analysis);

  assert.doesNotMatch(allText, /\d{1,3}\s*%/);
  assert.doesNotMatch(allText, /success probability|reversal probability|likely to (?:win|lose|succeed)/i);
  assert.doesNotMatch(allText, /you should (?:file|appeal|settle|plead)/i);
});

test("includes a disclaimer that the analysis is not a substitute for a licensed lawyer", () => {
  const analysis = buildAnalysis();
  assert.match(analysis.disclaimer, /licensed lawyer/i);
  assert.match(analysis.disclaimer, /not .*(?:legal advice|substitute)/i);
});

test("a Model Inference is never the only statement backing an outcome presented as confirmed", () => {
  const analysis = buildAnalysis();
  const aliOutcome = analysis.personByPersonOutcome.find(
    (item) => item.person === "Ali Gümüş"
  );

  assert.ok(aliOutcome.statements.some((item) => item.label === "Court Finding"));
  assert.ok(aliOutcome.statements.some((item) => item.label === "Model Inference"));
});

test("app/api/plan/route.ts builds the case analysis only from the layer-2 summary, gated on legal_document/legal_case_analysis", () => {
  const summaryIndex = planRouteSource.indexOf("createLegalDocumentSummaryFallback(");
  const analysisIndex = planRouteSource.indexOf("createLegalCaseAnalysis(");

  assert.ok(summaryIndex > -1 && analysisIndex > -1);
  assert.ok(summaryIndex < analysisIndex);
  assert.match(
    planRouteSource,
    /createLegalCaseAnalysis\(legalDocumentSummary\)/
  );
});

test("legal case analysis does not touch business, market, finance, real-estate, billing, or PDF logic", () => {
  const forbiddenPaths = [
    "app/lib/pdf-engine",
    "app/lib/report-engine",
    "app/lib/billing",
    "app/lib/ai/market-analysis",
    "app/lib/ai/adaptive-report-writer",
  ];

  for (const path of forbiddenPaths) {
    assert.doesNotMatch(planRouteSource, new RegExp(path.replace(/\//g, "\\/")));
  }
});
