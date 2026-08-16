import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// extractMarketDecisionText/marketDecisionColorCategory are module-private
// inside ReportPdfButton.tsx (not exported, heavy React/browser deps make
// direct import impractical) -- this file follows the established pattern
// used throughout this suite for such logic: extract the function bodies
// via regex from the real source and eval them in isolation, which still
// exercises the real, current implementation rather than a re-typed copy.
const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");

function loadFunction(name) {
  const match = pdfButtonSource.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} not found in ReportPdfButton.tsx`);
  // Strips the TypeScript parameter/return-type annotations from just the
  // signature line so `new Function` (plain JS) can parse it -- the
  // function body itself is real, unmodified source, only the type-only
  // syntax on the first line is removed.
  const [signatureLine, ...rest] = match[0].split("\n");
  const jsSignature = signatureLine
    .replace(/:\s*[^,)]+(?=[,)])/g, "")
    .replace(/\)\s*:\s*[^{]+\{/, ") {");
  const source = [jsSignature, ...rest].join("\n");
  const fn = new Function(`${source}\nreturn ${name};`)();
  return fn;
}

const extractMarketDecisionText = loadFunction("extractMarketDecisionText");
const marketDecisionColorCategory = loadFunction("marketDecisionColorCategory");

test("extractMarketDecisionText reads the real, observed merged-line shape ('Executive Decision: X (Confidence: NN%)')", () => {
  // Reproduces a real, live-observed defect: the cover page's DECISION
  // badge and "EXECUTIVE DECISION SNAPSHOT" preview both showed "GO" for
  // a report whose real Executive Summary decision was "CONDITIONAL GO" --
  // the extraction assumed formatExecutiveDecisionBrief's raw two-line
  // output shape (heading on its own line, "Decision: X (...)" on the
  // next), but the report's own downstream pipeline actually renders them
  // combined onto one line.
  const content = "Executive Decision: CONDITIONAL GO (Confidence: 62%)\nConfidence Reduced Because:\n- verified market size unavailable";
  assert.equal(extractMarketDecisionText(content), "CONDITIONAL GO");
});

test("extractMarketDecisionText also reads the two-line shape (defensive, in case upstream formatting reverts)", () => {
  const content = "Executive Decision\nDecision: GO (Confidence: 71%)\n\nConfidence Supported By:\n- strong evidence";
  assert.equal(extractMarketDecisionText(content), "GO");
});

test("extractMarketDecisionText handles a NO-GO decision", () => {
  const content = "Executive Decision: NO-GO (Confidence: 37%)\nConfidence Reduced Because:\n- competitive landscape evidence incomplete";
  assert.equal(extractMarketDecisionText(content), "NO-GO");
});

test("extractMarketDecisionText handles Turkish decision text", () => {
  const content = "Yönetici Kararı: KOŞULLU EVET (Güven: 40%)\nGüven Şu Nedenlerle Düşürüldü:";
  assert.equal(extractMarketDecisionText(content), "KOŞULLU EVET");
});

test("marketDecisionColorCategory buckets GO/CONDITIONAL/NO_GO correctly across all five languages, checking CONDITIONAL/NO_GO before the GO substring inside them", () => {
  const cases = [
    ["GO", "GO"],
    ["CONDITIONAL GO", "CONDITIONAL"],
    ["NO-GO", "NO_GO"],
    ["EVET", "GO"],
    ["KOŞULLU EVET", "CONDITIONAL"],
    ["HAYIR", "NO_GO"],
    ["BEDINGTES GO", "CONDITIONAL"],
    ["GO CONDITIONNEL", "CONDITIONAL"],
    ["GO CONDICIONAL", "CONDITIONAL"],
  ];
  for (const [text, expected] of cases) {
    assert.equal(marketDecisionColorCategory(text), expected, `expected ${text} -> ${expected}`);
  }
});

test("the cover's DECISION badge and EXECUTIVE DECISION SNAPSHOT preview both read from marketDecisionText/marketTopRisks for Market Intelligence, not the generic executiveSnapshot", () => {
  // Reproduces a second instance of the same defect: the big DECISION
  // badge was fixed to use marketDecisionText, but the smaller preview
  // box directly below the title still used the old, independently
  // (and differently) computed executiveSnapshot.decision/mainRisk --
  // live-confirmed to disagree with the badge on the very same report.
  const legalDecisionMatch = pdfButtonSource.match(
    /const legalDecision = isLegalReport\s*\?[\s\S]*?\n\s*: isMarketIntelligenceReport\s*\n\s*\? marketDecisionText \|\| executiveSnapshot\.decision/
  );
  assert.ok(legalDecisionMatch, "DECISION badge (legalDecision) must read marketDecisionText for Market Intelligence");

  const previewMatch = pdfButtonSource.match(
    /isMarketIntelligenceReport\s*\n\s*\? `\$\{localizePdfPresentationLabel\("Decision", pdfLocale\)\}: \$\{marketDecisionText \|\| legalDecision\}\. \$\{localizePdfPresentationLabel\("Main Risk", pdfLocale\)\}: \$\{marketTopRisks\[0\] \|\| executiveSnapshot\.mainRisk\}`/
  );
  assert.ok(previewMatch, "EXECUTIVE DECISION SNAPSHOT preview must also read marketDecisionText/marketTopRisks for Market Intelligence");
});
