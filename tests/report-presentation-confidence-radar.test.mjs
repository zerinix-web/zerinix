import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// report-presentation.ts has REAL (non-type-only) "@/"-aliased imports
// (report-output-sanitization, report-engine/executive-decision-brief), so
// plain `node --test` can't resolve it directly -- same established
// pattern as executive-decision-pipeline.test.mjs's importExecutiveQualityGate:
// rewrite each specifier to an absolute file:// path and import from a
// throwaway temp file.
async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  const sanitizationPath = join(repoRoot, "app/lib/report-output-sanitization.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(sanitizationPath).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-presentation-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot } = await importReportPresentation();

function investmentScore(overrides = {}) {
  return {
    totalScore: 62,
    confidence: 62,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 70, maximumScore: 100, label: "Market", reasoning: [] },
      financialScore: { score: 40, maximumScore: 100, label: "Financial", reasoning: [] },
      founderScore: { score: 55, maximumScore: 100, label: "Founder", reasoning: [] },
      executionScore: { score: 30, maximumScore: 100, label: "Execution", reasoning: [] },
      riskScore: { score: 45, maximumScore: 100, label: "Risk", reasoning: [] },
      competitionScore: { score: 80, maximumScore: 100, label: "Competition", reasoning: [] },
      technologyScore: { score: 65, maximumScore: 100, label: "Technology", reasoning: [] },
    },
    ...overrides,
  };
}

test("confidenceRadar dimensions are independently computed, not collapsed to the same blended score", () => {
  // Reproduces a real, confirmed defect: Market/Financial/Execution/
  // Product/Evidence all fell back to the SAME single investmentScore.confidence
  // value (e.g. 54/54/54/54/54) whenever the AI's own prose didn't happen
  // to contain a literal "Market Confidence:"/"Execution Readiness:"-style
  // label -- which none of the generation prompts ever ask it to write, so
  // this fired on virtually every real report.
  const snapshot = buildExecutiveSnapshot("", investmentScore(), undefined);
  const scores = snapshot.confidenceRadar.map((d) => d.score);

  assert.equal(new Set(scores).size, scores.length, `expected 5 distinct scores, got: ${JSON.stringify(scores)}`);
  assert.ok(!scores.every((s) => s === scores[0]), "dimensions must not all be identical");
});

test("each confidenceRadar dimension maps to its own real decisionEngine category score", () => {
  const snapshot = buildExecutiveSnapshot("", investmentScore(), undefined);
  const byLabel = Object.fromEntries(snapshot.confidenceRadar.map((d) => [d.label, d.score]));

  assert.equal(byLabel.Market, 70);
  assert.equal(byLabel.Financial, 40);
  assert.equal(byLabel.Execution, 30);
  assert.equal(byLabel.Product, 65);
  assert.equal(byLabel.Evidence, 80);
});

test("a dimension with no real signal available (no investmentScore, no labeled text) reports null (rendered as 'Validation Required'), never a fabricated shared number", () => {
  const snapshot = buildExecutiveSnapshot("Some report text with no labeled dimension scores.", undefined, undefined);
  const scores = snapshot.confidenceRadar.map((d) => d.score);

  assert.ok(
    scores.every((s) => s === null),
    `expected all null when no real signal exists, got: ${JSON.stringify(scores)}`
  );
});

test("a real labeled score in the report's own text still takes priority over the decisionEngine fallback", () => {
  const content = "Market Confidence: 91%";
  const snapshot = buildExecutiveSnapshot(content, investmentScore(), undefined);
  const market = snapshot.confidenceRadar.find((d) => d.label === "Market");
  assert.equal(market.score, 91);
});
