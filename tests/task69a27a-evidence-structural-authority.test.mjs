import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// TASK #69A-27A -- "Make Evidence scoring structurally authoritative and
// eliminate Web/PDF score drift." report-presentation.ts has REAL
// (non-type-only) "@/"-aliased imports, so plain `node --test` can't
// resolve it directly -- same established rewrite-to-absolute-file://
// pattern used by report-presentation-confidence-radar.test.mjs and
// executive-decision-pipeline.test.mjs.
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

  const dir = mkdtempSync(join(tmpdir(), "zerinix-task69a27a-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot, readFounderReadinessMetrics } = await importReportPresentation();

// The REAL persisted BIV report's own numbers, as reported by the user
// after regeneration under #69A-27's founder-scoring fixes and before
// #69A-27A's confidenceRadar fix: Decision WAIT ("MONITOR"-class verdict),
// Decision Confidence 48%, Founder Readiness 40/100, with dimensions Idea
// Quality 66, Market Attractiveness 66, Business Model Quality 54,
// Validation Confidence 60, Execution Complexity 66, Evidence Confidence
// 36, Founder Evidence 34; Confidence Radar Market 55/Financial 26/
// Execution 52/Product 58, and the disputed Evidence dimension (competing
// values 41 seen on web vs. 36 seen in the exported PDF for the exact
// same persisted report).
function realCaseInvestmentScore() {
  return {
    totalScore: 48,
    confidence: 48,
    recommendation: "WAIT",
    decisionEngine: {
      marketScore: { score: 55, maximumScore: 100, label: "Market Score", reasoning: [] },
      financialScore: { score: 26, maximumScore: 100, label: "Financial Score", reasoning: [] },
      founderScore: {
        score: 40,
        maximumScore: 100,
        label: "Founder Score",
        reasoning: [],
        dimensionScores: [
          { key: "ideaQuality", label: "Idea Quality", score: 66 },
          { key: "marketAttractiveness", label: "Market Attractiveness", score: 66 },
          { key: "businessModelQuality", label: "Business Model Quality", score: 54 },
          { key: "validationConfidence", label: "Validation Confidence", score: 60 },
          { key: "executionComplexity", label: "Execution Complexity", score: 66 },
          { key: "evidenceConfidence", label: "Evidence Confidence", score: 36 },
          { key: "founderEvidence", label: "Founder Evidence", score: 34 },
        ],
      },
      executionScore: { score: 52, maximumScore: 100, label: "Execution Score", reasoning: [] },
      riskScore: { score: 52, maximumScore: 100, label: "Risk Score", reasoning: [] },
      // The Confidence Radar "Evidence" dimension's real, structured,
      // canonical source (competitive-advantage/moat, a DIFFERENT concept
      // than Founder Readiness's Evidence Confidence/Founder Evidence --
      // see report-presentation.ts's own buildConfidenceRadar comment).
      // 41 is the web dashboard's own historically-correct value (it never
      // had the Founder Readiness prose in scope to begin with); the PDF's
      // 36 was the confirmed-live defect this ticket fixes.
      competitionScore: { score: 41, maximumScore: 100, label: "Competition Score", reasoning: [] },
      technologyScore: { score: 58, maximumScore: 100, label: "Technology Score", reasoning: [] },
    },
  };
}

// The literal generated-content shapes real callers actually pass in.
// Web's ExecutiveSnapshotPanel passes only the Executive Summary section's
// own content (page.tsx: `buildExecutiveSnapshot(section.content, ...)`).
const executiveSummarySectionContent =
  "Decision: WAIT (Confidence: 48%). The opportunity shows moderate promise " +
  "but material validation gaps remain before a stronger recommendation is defensible.";

// The PDF's fullReportContent concatenates EVERY section's title + content
// together (ReportPdfButton.tsx: `pdfSections.map(s => \`${s.title}\\n${s.content}\`).join("\\n\\n")`),
// which is why it also contains the Founder Readiness section's own
// generated text -- built verbatim by buildCanonicalFounderScore in
// plan-executor.ts, including its literal "Evidence Confidence: NN/100 -
// ..." and "Founder Evidence: NN/100 - ..." lines.
const founderReadinessSectionContent = [
  "Founder Readiness Score: 40/100",
  "Idea Quality: 66/100 - The opportunity is evaluated on market pull, model strength, and economic potential before founder evidence is considered.",
  "Market Attractiveness: 66/100 - The market appears attractive if reachable demand and an obtainable beachhead can be validated.",
  "Business Model Quality: 54/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.",
  "Validation Confidence: 60/100 - Missing traction lowers confidence, not the underlying idea quality.",
  "Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.",
  "Evidence Confidence: 36/100 - Evidence remains directional until customer, pricing, retention, and acquisition data are observed.",
  "Founder Evidence: 34/100 - Founder readiness should be validated through domain experience, operating capacity, and the ability to run the first proof cycles.",
].join("\n");

function buildFullReportContent() {
  return [
    `Executive Summary\n${executiveSummarySectionContent}`,
    `Founder Readiness\n${founderReadinessSectionContent}`,
  ].join("\n\n");
}

test("[#69A-27A real-case] Decision remains WAIT (the MONITOR-class verdict) identically for web-style and PDF-style content", () => {
  const score = realCaseInvestmentScore();
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, score, undefined);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);

  assert.equal(web.decision, "WAIT");
  assert.equal(pdf.decision, "WAIT");
  assert.equal(web.decision, pdf.decision);
});

test("[#69A-27A real-case] Decision Confidence remains 48% identically for web-style and PDF-style content", () => {
  const score = realCaseInvestmentScore();
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, score, undefined);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);

  assert.equal(web.confidenceScore, 48);
  assert.equal(pdf.confidenceScore, 48);
});

test("[#69A-27A real-case] Founder Readiness overall score remains 40/100 identically for web-style and PDF-style content", () => {
  const score = realCaseInvestmentScore();
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, score, undefined);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);

  assert.equal(web.founderScoreValue, 40);
  assert.equal(pdf.founderScoreValue, 40);
});

test("[#69A-27A real-case] Founder Readiness dimensions remain semantically mapped correctly, independent of content scope", () => {
  const score = realCaseInvestmentScore();
  const metrics = readFounderReadinessMetrics(score);

  assert.equal(metrics.founderReadinessScore, 40);
  assert.equal(metrics.ideaQuality, 66);
  assert.equal(metrics.marketAttractiveness, 66);
  assert.equal(metrics.businessModelQuality, 54);
  assert.equal(metrics.validationConfidence, 60);
  assert.equal(metrics.executionComplexity, 66);
  assert.equal(metrics.evidenceConfidence, 36);
  assert.equal(metrics.founderEvidence, 34);
});

test("[#69A-27A real-case] Executive Snapshot Confidence Radar is structurally stable: Market/Financial/Execution/Product agree, and Evidence now converges on the canonical 41 for BOTH web and PDF content", () => {
  const score = realCaseInvestmentScore();
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, score, undefined);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);

  const byLabel = (snapshot) => Object.fromEntries(snapshot.confidenceRadar.map((d) => [d.label, d.score]));
  const webRadar = byLabel(web);
  const pdfRadar = byLabel(pdf);

  assert.deepEqual(webRadar, { Market: 55, "Financial Research Coverage": 26, Execution: 52, Product: 58, "Moat Evidence": 41 });
  // THE FIX: before #69A-27A, this is exactly where PDF diverged to 36
  // (Founder Readiness's own "Evidence Confidence" prose, wrongly matched
  // as this dimension's alias) while web correctly showed 41. Both must
  // now be 41, by construction, not coincidence.
  assert.deepEqual(pdfRadar, { Market: 55, "Financial Research Coverage": 26, Execution: 52, Product: 58, "Moat Evidence": 41 });
  assert.deepEqual(webRadar, pdfRadar, "web and PDF Confidence Radar must be identical for the same persisted report");
});

test("[#69A-27A real-case] web and PDF Confidence Radar Evidence use the same canonical decisionEngine.competitionScore field, never Founder Readiness's Evidence Confidence/Founder Evidence", () => {
  const score = realCaseInvestmentScore();
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, score, undefined);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);

  const webEvidence = web.confidenceRadar.find((d) => d.label === "Moat Evidence").score;
  const pdfEvidence = pdf.confidenceRadar.find((d) => d.label === "Moat Evidence").score;

  assert.equal(webEvidence, score.decisionEngine.competitionScore.score);
  assert.equal(pdfEvidence, score.decisionEngine.competitionScore.score);
  assert.notEqual(webEvidence, score.decisionEngine.founderScore.dimensionScores.find((d) => d.key === "evidenceConfidence").score);
  assert.notEqual(pdfEvidence, score.decisionEngine.founderScore.dimensionScores.find((d) => d.key === "evidenceConfidence").score);
});

test("[#69A-27A real-case] Founder Readiness Evidence Confidence (36) remains independent of the Confidence Radar Evidence dimension (41)", () => {
  const score = realCaseInvestmentScore();
  const metrics = readFounderReadinessMetrics(score);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);
  const radarEvidence = pdf.confidenceRadar.find((d) => d.label === "Moat Evidence").score;

  assert.equal(metrics.evidenceConfidence, 36);
  assert.equal(radarEvidence, 41);
  assert.notEqual(metrics.evidenceConfidence, radarEvidence, "these are two different concepts and must never be forced equal");
});

test("[#69A-27A real-case] Founder Evidence (34) remains independent of both Evidence Confidence (36) and the Confidence Radar Evidence dimension (41)", () => {
  const score = realCaseInvestmentScore();
  const metrics = readFounderReadinessMetrics(score);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);
  const radarEvidence = pdf.confidenceRadar.find((d) => d.label === "Moat Evidence").score;

  assert.equal(metrics.founderEvidence, 34);
  assert.notEqual(metrics.founderEvidence, metrics.evidenceConfidence);
  assert.notEqual(metrics.founderEvidence, radarEvidence);
});

test("[#69A-27A real-case] no renderer can silently substitute one evidence metric for another: all three canonical evidence-related numbers stay distinct and independently addressable", () => {
  const score = realCaseInvestmentScore();
  const metrics = readFounderReadinessMetrics(score);
  const pdf = buildExecutiveSnapshot(buildFullReportContent(), score, undefined);
  const radarEvidence = pdf.confidenceRadar.find((d) => d.label === "Moat Evidence").score;

  const distinctValues = new Set([metrics.evidenceConfidence, metrics.founderEvidence, radarEvidence]);
  assert.equal(distinctValues.size, 3, `expected 3 genuinely distinct evidence-related values, got: ${JSON.stringify([...distinctValues])}`);
});

test("[#69A-27A real-case, historical report] a persisted report predating decisionEngine.competitionScore degrades honestly to null/prose fallback, never a reconstructed/fabricated Evidence value", () => {
  const legacyScore = {
    totalScore: 48,
    confidence: 48,
    recommendation: "WAIT",
    // No decisionEngine at all -- the pre-#69A-17/#69A-27A persisted shape.
  };
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, legacyScore, undefined);
  const evidence = web.confidenceRadar.find((d) => d.label === "Moat Evidence");

  assert.equal(evidence.score, null, "no fabricated Evidence value for a historical report with no structured score and no matching labeled prose");
});

test("[#69A-27A protection: #69A-27 corrections] fatalBlockers-driven WAIT is untouched by the confidenceRadar fix", () => {
  const score = {
    ...realCaseInvestmentScore(),
    recommendation: "WAIT",
    fatalBlockers: [{ key: "founderEvidence", label: "Founder Evidence", score: 12 }],
  };
  const web = buildExecutiveSnapshot(executiveSummarySectionContent, score, undefined);

  assert.equal(web.decision, "WAIT");
});
