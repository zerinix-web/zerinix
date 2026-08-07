import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  evidenceTypeLabels,
  assessSectionEvidenceConfidence,
  formatEvidenceConfidenceBlock,
  appendEvidenceConfidenceBlock,
} from "../app/lib/report-evidence-confidence.ts";

test("only the 6 required evidence-type labels exist", () => {
  assert.deepEqual(
    [...evidenceTypeLabels].sort(),
    [
      "Benchmark Data",
      "Model Derived",
      "Planning Assumption",
      "User Provided",
      "Validation Required",
      "Verified Source",
    ].sort()
  );
});

test("a section with [Verified]/[Estimated] tags is classified High confidence with a dominance explanation", () => {
  const content =
    "[Verified] Monthly revenue is 150,000 TL per branch as reported by the user. [Estimated] Industry gross margin benchmark is 62%. This is a strong beachhead.";
  const assessment = assessSectionEvidenceConfidence(content);

  assert.equal(assessment.evidenceQuality, "High");
  assert.ok(assessment.confidenceScore >= 75);
  assert.deepEqual(assessment.primaryEvidenceTypes, ["User Provided", "Benchmark Data"]);
  assert.equal(assessment.isMixedEvidence, true);

  const block = formatEvidenceConfidenceBlock(assessment, "English");
  assert.match(block, /Evidence & Confidence/);
  assert.match(block, /Evidence Quality: High/);
  assert.match(block, /Confidence Score: \d+\/100/);
  assert.match(block, /User Provided dominates the conclusion, with Benchmark Data as a secondary basis/);
});

test("a section that depends mostly on assumptions gets an explicit confidence reduction, never High", () => {
  const content =
    "[Assumption] Customer acquisition cost is assumed at $40. [Assumption] Retention is assumed at 70%. [Assumption] Churn is assumed at 5%.";
  const assessment = assessSectionEvidenceConfidence(content);

  assert.equal(assessment.evidenceQuality, "Low");
  assert.deepEqual(assessment.primaryEvidenceTypes, ["Planning Assumption"]);
  assert.ok(assessment.confidenceScore < 50, "assumption-dominated sections must never read as Medium/High confidence");
});

test("assumptions are never labeled as verified facts", () => {
  const assumptionOnly = assessSectionEvidenceConfidence(
    "[Assumption] Pricing is assumed at $29/mo. [Assumption] Payback is assumed at 6 months."
  );
  assert.ok(!assumptionOnly.primaryEvidenceTypes.includes("Verified Source"));
  assert.ok(!assumptionOnly.primaryEvidenceTypes.includes("User Provided"));
  assert.notEqual(assumptionOnly.evidenceQuality, "High");
});

test("unlabeled numeric claims are detected and drive an explicit validation recommendation", () => {
  const content = "The market will grow by 45% next year and reach $3.2B in size.";
  const assessment = assessSectionEvidenceConfidence(content);

  assert.ok(assessment.unsupportedNumericClaimCount > 0);
  assert.equal(assessment.evidenceQuality, "Low");

  const block = formatEvidenceConfidenceBlock(assessment, "English");
  assert.match(block, /Missing Evidence:/);
  assert.match(block, /Recommendation: validate/);
});

test("a section with zero classified evidence and zero numeric claims still reads Low, never fabricated as confident", () => {
  const assessment = assessSectionEvidenceConfidence("This is a purely narrative sentence with no numbers at all.");
  assert.equal(assessment.evidenceQuality, "Low");
  assert.equal(assessment.primaryEvidenceTypes[0], "Validation Required");
});

test("appendEvidenceConfidenceBlock is a no-op for empty content and appends cleanly otherwise", () => {
  assert.equal(appendEvidenceConfidenceBlock("", "English"), "");
  assert.equal(appendEvidenceConfidenceBlock("   ", "English"), "   ");

  const appended = appendEvidenceConfidenceBlock("[Verified] Revenue is $10k/mo.", "English");
  assert.match(appended, /\[Verified\] Revenue is \$10k\/mo\.\n\nEvidence & Confidence/);
});

test("the block renders in all 5 supported languages with distinct, non-English text for TR/DE/FR/ES", () => {
  const assessment = assessSectionEvidenceConfidence(
    "[Assumption] Placeholder assumption text so a block is produced."
  );
  const english = formatEvidenceConfidenceBlock(assessment, "English");
  for (const language of ["Turkish", "German", "French", "Spanish"]) {
    const localized = formatEvidenceConfidenceBlock(assessment, language);
    assert.notEqual(localized, english);
    assert.match(localized, /\d+\/100/);
  }
});

// --- Wiring: the block must actually be applied to major sections in ---
// --- both Business Idea Validation and Market Intelligence, and the ---
// --- Executive Summary must carry the 4 new rollup items. ---

const planSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
const marketSource = readFileSync("app/api/market-analysis/route.ts", "utf8");

test("plan-executor.ts wires evidence-confidence blocks into major narrative sections and the executive summary rollup", () => {
  assert.match(planSource, /appendEvidenceConfidenceToMajorPlanSections/);
  assert.match(planSource, /buildExecutiveSummaryConfidenceRollup/);
  assert.match(planSource, /Overall Report Confidence/);
  assert.match(planSource, /Biggest Unknown/);
  assert.match(planSource, /Highest Confidence Finding/);
  assert.match(planSource, /Lowest Confidence Finding/);

  for (const field of ["problem", "solution", "targetCustomer", "marketOpportunity", "risks", "executiveRecommendation"]) {
    assert.match(planSource, new RegExp(`"${field}"`));
  }
});

test("market-analysis route.ts wires evidence-confidence blocks into major narrative sections and the executive summary rollup", () => {
  assert.match(marketSource, /appendEvidenceConfidenceToMajorMarketSections/);
  assert.match(marketSource, /buildMarketExecutiveSummaryConfidenceRollup/);
  assert.match(marketSource, /Overall Report Confidence/);
  assert.match(marketSource, /Biggest Unknown/);
  assert.match(marketSource, /Highest Confidence Finding/);
  assert.match(marketSource, /Lowest Confidence Finding/);
});

test("neither plan-executor.ts nor market-analysis route.ts changed their report field schemas", () => {
  assert.doesNotMatch(planSource, /evidenceConfidence:\s*\{/);
  assert.doesNotMatch(marketSource, /evidenceConfidence:\s*\{/);
});

// --- Display surfaces must never strip the new block: this pins down ---
// --- the exact filter regexes so a future edit to any of the 3 ---
// --- "clean evidence metadata" functions can't silently start eating it. ---

test("the compound Evidence & Confidence labels survive the 'clean evidence metadata' display filter", () => {
  // This is the exact line-start filter shared (independently
  // duplicated, per this codebase's convention) by
  // components/planner/report-utils.ts's cleanEvidenceMetadataForDisplay,
  // app/dashboard/[id]/ReportPdfButton.tsx's cleanPdfEvidenceMetadataText,
  // and app/dashboard/[id]/page.tsx's cleanEvidenceMetadataForDisplay.
  // It strips bare "confidence:"/"evidence:" lines (internal debug
  // metadata) -- it must NOT strip this feature's compound labels
  // ("Evidence Quality:", "Confidence Score:", ...).
  const metadataLineFilter =
    /^(?:[-*•]\s*)?(?:formula|assumptions?|varsayımlar|confidence|güven|evidence|validation evidence|validation needed|metadata|referans|raw evidence metadata|raw validation text|raw validation context|raw benchmark context|internal evidence keys?|benchmark(?:source| source| comparison)?)\s*[:=]/i;

  const sampleLines = [
    "- Evidence Quality: High",
    "- Confidence Score: 77/100",
    "- Primary Evidence Type(s): User Provided, Benchmark Data",
    "- Missing Evidence: 1 numeric claim(s) in this section carry no evidence label.",
    "Evidence & Confidence",
  ];

  for (const line of sampleLines) {
    assert.equal(
      metadataLineFilter.test(line.trim()),
      false,
      `the shared metadata filter must not strip: ${line}`
    );
  }

  for (const filePath of [
    "components/planner/report-utils.ts",
    "app/dashboard/[id]/ReportPdfButton.tsx",
    "app/dashboard/[id]/page.tsx",
  ]) {
    const source = readFileSync(filePath, "utf8");
    assert.match(source, /confidence\|güven\|evidence/);
  }
});
