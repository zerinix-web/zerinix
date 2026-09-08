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

test("[UPDATED BY #69A-27A] the structured decisionEngine score now takes priority over the report's own labeled text, when both exist", () => {
  // TASK #69A-27A -- this assertion previously encoded the OPPOSITE
  // precedence (prose label wins over decisionEngine) and was itself the
  // root cause of a confirmed live defect: the same persisted report's
  // "Evidence" confidenceRadar dimension showed 41 on the web dashboard
  // (which passes only the Executive Summary section's content into
  // buildExecutiveSnapshot, so no prose label ever matched, correctly
  // falling through to decisionEngine.competitionScore.score) but showed
  // 36 in the exported PDF (which passes the FULL concatenation of every
  // section's content, so the prose-priority rule let an unrelated
  // section's "Evidence Confidence: 36/100 - ..." text -- Founder
  // Readiness's OWN dimension, a different concept entirely -- win
  // instead). The structured decisionEngine score is now authoritative
  // whenever it exists, so every caller reads the SAME value for the
  // SAME persisted report regardless of how much of the report's text it
  // happens to pass in. Prose-label scanning is still the correct
  // fallback for report types where decisionEngine has no value at all
  // (Market Intelligence; see the two tests above/below), so this test
  // now proves the opposite direction: a labeled prose score must NOT
  // override a real structured category score.
  const content = "Market Confidence: 91%";
  const snapshot = buildExecutiveSnapshot(content, investmentScore(), undefined);
  const market = snapshot.confidenceRadar.find((d) => d.label === "Market");
  assert.equal(market.score, 70, "decisionEngine.marketScore.score (70) must win over the labeled prose text (91)");
});

test("[#69A-27A] a labeled prose score is still used as a fallback when decisionEngine has no value for that dimension", () => {
  const content = "Market Confidence: 91%";
  const snapshot = buildExecutiveSnapshot(content, undefined, undefined);
  const market = snapshot.confidenceRadar.find((d) => d.label === "Market");
  assert.equal(market.score, 91);
});

test("[#69A-27A] Evidence Confidence prose text (Founder Readiness's own dimension label) never leaks into the confidenceRadar Evidence dimension", () => {
  // Reproduces the exact live collision: the Founder Readiness section's
  // generated text literally contains "Evidence Confidence: 36/100 - ...".
  // The confidenceRadar "Evidence" dimension is a different concept
  // (decisionEngine.competitionScore, competitive-advantage/moat) and must
  // never read this line -- whether or not it happens to be inside the
  // `content` string this particular caller passed in.
  const content = [
    "Founder Readiness Score: 40/100",
    "Evidence Confidence: 36/100 - Evidence remains directional until customer data is observed.",
    "Founder Evidence: 34/100 - Founder readiness should be validated.",
  ].join("\n");

  const withDecisionEngine = buildExecutiveSnapshot(content, investmentScore(), undefined);
  const evidenceWithEngine = withDecisionEngine.confidenceRadar.find((d) => d.label === "Evidence");
  assert.equal(
    evidenceWithEngine.score,
    80,
    "must read decisionEngine.competitionScore.score (80), never the Founder Readiness 'Evidence Confidence' prose (36)"
  );

  const withoutDecisionEngine = buildExecutiveSnapshot(content, undefined, undefined);
  const evidenceWithoutEngine = withoutDecisionEngine.confidenceRadar.find((d) => d.label === "Evidence");
  assert.notEqual(
    evidenceWithoutEngine.score,
    36,
    "even with no decisionEngine fallback available, the 'Evidence Confidence' label must not be treated as an alias of this dimension"
  );
});

test("[#69A-27A] web (single-section content) and PDF (full concatenated content) callers agree on every confidenceRadar dimension for the same investmentScore", () => {
  // Reproduces the real-world call-site asymmetry directly: page.tsx's
  // ExecutiveSnapshotPanel passes only the Executive Summary section's
  // own content; ReportPdfButton.tsx's fullReportContent concatenates
  // every section (title + content) together. Both must resolve to the
  // identical confidenceRadar array for the identical investmentScore.
  const executiveSummarySection = "GO (Confidence: 48%). The opportunity shows moderate promise.";
  const founderReadinessSection = [
    "Founder Readiness Score: 40/100",
    "Idea Quality: 66/100 - The opportunity is evaluated on market pull.",
    "Evidence Confidence: 36/100 - Evidence remains directional.",
    "Founder Evidence: 34/100 - Founder readiness should be validated.",
  ].join("\n");
  const fullReportContent = [
    `Executive Summary\n${executiveSummarySection}`,
    `Founder Readiness\n${founderReadinessSection}`,
  ].join("\n\n");

  const score = investmentScore();
  const webSnapshot = buildExecutiveSnapshot(executiveSummarySection, score, undefined);
  const pdfSnapshot = buildExecutiveSnapshot(fullReportContent, score, undefined);

  assert.deepEqual(
    webSnapshot.confidenceRadar,
    pdfSnapshot.confidenceRadar,
    `web and PDF confidenceRadar must be identical for the same investmentScore, got web=${JSON.stringify(webSnapshot.confidenceRadar)} pdf=${JSON.stringify(pdfSnapshot.confidenceRadar)}`
  );
});
