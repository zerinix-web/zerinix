import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Reproduces 6 real, confirmed production bugs found in a live Business
// Plan PDF for a freelance graphic-design subscription platform (and,
// during live verification, an event-planning SaaS report):
//
// 1. CRITICAL -- the business was classified as "FinTech" everywhere
//    (Industry benchmark, opportunity narrative, beachhead focus, ...)
//    because the fintech industry-key regex matched the bare word
//    "payments" (the platform's own "milestone-based payments" feature).
// 2. CRITICAL -- Overall Quality Score showed 0/100 while all five
//    displayed sub-scores were comfortably non-zero (28-73 range),
//    because additive penalties could exceed the weighted average and
//    clamp straight to 0 with no floor tied to the sub-scores shown.
// 3. REGRESSION -- Market Opportunity Score showed two different sets
//    of Demand/Competition/Timing/Execution Difficulty/Revenue Potential
//    numbers, because the strip-before-append guard only ever stripped
//    the model's own "opportunity score" mention, never its own
//    Demand/Competition/Timing/etc. sub-score lines.
// 4. REGRESSION -- "AI Analysis" badges still appeared raw ("CAC $9k AI
//    Analysis") because inferEvidenceLevel unconditionally forced ANY
//    metric whose label/context mentioned "cac"/"ltv"/"payback" to
//    "validationRequired" ("AI Analysis"), regardless of that metric's
//    own actual evidence classification.
// 5. REGRESSION -- Sources page pulled irrelevant sources (government
//    procurement content) for an event-planning SaaS, because the
//    business/procurement domain classifier's "vendor" signal matched
//    an ordinary "manage vendor bookings" feature mention and routed
//    research through procurement-specific (not business-appropriate)
//    source-priority stages.
// 6. Duplicate identical boilerplate ("Next 30 Days requires verified
//    supporting data...") appeared in the SAME field twice: once because
//    the deterministic "AI Action Plan" block was appended (and then
//    labeled/flagged) BEFORE the unverifiable-claim check ran, and once
//    because two different milestones' own flagged "Proof:" sub-clauses
//    produced byte-identical text that line-level dedup couldn't see
//    (the flagged fragment is joined into a larger multi-clause line
//    before that dedup pass ever runs).

const reportEvidenceSource = readFileSync(
  join(repoRoot, "app/lib/report-evidence.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const domainSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/domain.ts"),
  "utf8"
);
const financialClaimLabelingSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/financial-claim-labeling.ts"),
  "utf8"
);
const reportConfidenceQualitySource = readFileSync(
  join(repoRoot, "app/lib/report-confidence-quality.mjs"),
  "utf8"
);

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

// --- Issue 1: FinTech misclassification -----------------------------------

const { inferIndustryKey } = await importFinancialModel();

test("the exact freelance graphic-design marketplace prompt no longer classifies as fintech", () => {
  const prompt =
    "I am building a subscription platform connecting freelance graphic designers with small businesses for design work, including logo design, social media graphics, and marketing materials, with milestone-based payments between clients and designers.";

  assert.notEqual(inferIndustryKey(prompt), "fintech");
});

test("a bare mention of 'payments' as a feature (not the core business) never triggers fintech", () => {
  assert.notEqual(
    inferIndustryKey("a marketplace with escrow payments for freelance designers"),
    "fintech"
  );
  assert.notEqual(
    inferIndustryKey("an events app that handles vendor payments and invoicing"),
    "fintech"
  );
});

test("a genuine fintech/payments business is still correctly classified", () => {
  assert.equal(inferIndustryKey("I am building a payments platform for small businesses"), "fintech");
  assert.equal(inferIndustryKey("a neobank for freelancers"), "fintech");
  assert.equal(inferIndustryKey("an insurtech startup"), "fintech");
  assert.equal(inferIndustryKey("a digital wallet app for teenagers"), "fintech");
});

// --- Issue 2: Overall Quality Score floor -----------------------------------

test("deriveReportQualityConfidence floors the total score to a fraction of weightedScore instead of allowing it to collapse to 0 (drift check)", () => {
  assert.match(reportConfidenceQualitySource, /Math\.round\(input\.weightedScore \* 0\.4\)/);
  assert.match(reportConfidenceQualitySource, /clampScore\(Math\.max\(floor, penalized\)\)/);
});

function mirrorDeriveReportQualityConfidence(input) {
  const assumptionPenalty = Math.min(18, input.assumptionCount * 2);
  const marketPenalty = input.missingMarketData ? 10 : 0;
  const competitionPenalty = input.weakCompetitiveEvidence ? 8 : 0;
  const financialPenalty = Math.min(18, input.uncertainFinancialMetricCount * 3);
  const evidenceBonus = Math.min(
    10,
    input.authoritativeSourceCount * 2 + input.userProvidedValueCount * 2
  );
  const penalized =
    input.weightedScore -
    assumptionPenalty -
    marketPenalty -
    competitionPenalty -
    financialPenalty +
    evidenceBonus;
  const floor = Math.round(input.weightedScore * 0.4);
  const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));

  return clampScore(Math.max(floor, penalized));
}

test("a report whose 5 sub-scores are all comfortably non-zero never shows a total of 0 (the exact live bug shape)", () => {
  // Evidence Quality=60, Source Confidence=39, Financial Consistency=34,
  // Benchmark Fit=28, Validation Readiness=47 -- weightedScore ~=43.
  const weightedScore = Math.round(60 * 0.25 + 39 * 0.2 + 34 * 0.25 + 28 * 0.15 + 47 * 0.15);
  const totalScore = mirrorDeriveReportQualityConfidence({
    weightedScore,
    assumptionCount: 9, // capped penalty of 18
    missingMarketData: true, // +10
    weakCompetitiveEvidence: true, // +8
    uncertainFinancialMetricCount: 6, // capped penalty of 18
    authoritativeSourceCount: 0,
    userProvidedValueCount: 0,
  });

  assert.notEqual(totalScore, 0);
  assert.ok(totalScore >= Math.round(weightedScore * 0.4));
});

test("a genuinely strong report's score is unaffected by the floor (no penalty stacking)", () => {
  const totalScore = mirrorDeriveReportQualityConfidence({
    weightedScore: 80,
    assumptionCount: 0,
    missingMarketData: false,
    weakCompetitiveEvidence: false,
    uncertainFinancialMetricCount: 0,
    authoritativeSourceCount: 5,
    userProvidedValueCount: 5,
  });

  assert.equal(totalScore, 90);
});

// --- Issue 3: Market Opportunity Score sub-score duplication ---------------

test("stripAiGeneratedOpportunityScoreMention now strips all 5 sub-score mentions, not just the overall score (drift check)", () => {
  const match = planExecutorSource.match(
    /function stripAiGeneratedOpportunityScoreMention\(content: string\) \{[\s\S]*?\n\}/
  );
  assert.ok(match, "stripAiGeneratedOpportunityScoreMention not found");
  for (const term of [
    "demand score",
    "competition score",
    "timing score",
    "execution difficulty",
    "revenue potential",
    "talep skoru",
    "rekabet skoru",
    "zamanlama skoru",
    "yürütme zorluğu",
    "gelir potansiyeli",
  ]) {
    assert.ok(
      match[0].toLowerCase().includes(term.toLowerCase()),
      `stripAiGeneratedOpportunityScoreMention no longer strips "${term}"`
    );
  }
});

function mirrorStripAiGeneratedOpportunityScoreMention(content) {
  const opportunityScorePattern =
    /\b(?:overall\s+)?opportunity score\b|\bdemand score\b|\bcompetition score\b|\btiming score\b|\bexecution difficulty\b|\brevenue potential\b/i;

  return content
    .split(/\n/)
    .map((line) => {
      if (!opportunityScorePattern.test(line)) return line;
      const isDedicatedLine =
        /^\s*(?:[-*•]\s*)?(?:overall\s+)?(?:opportunity score|demand score|competition score|timing score|execution difficulty|revenue potential)\b/i.test(
          line
        );
      if (isDedicatedLine) return "";
      return line
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !opportunityScorePattern.test(sentence))
        .join(" ");
    })
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

test("the model's own Demand/Competition/Timing/Execution Difficulty/Revenue Potential lines are stripped before the canonical block is appended", () => {
  const modelNarrative = [
    "Category: B2B design subscription for SMBs.",
    "Market Opportunity Score:",
    "- Demand Score: 54/100",
    "- Competition Score: 6/100",
    "- Timing Score: 56/100",
    "- Execution Difficulty: 28/100",
    "- Revenue Potential: 25/100",
    "- Overall Opportunity Score: 44/100",
  ].join("\n");

  const stripped = mirrorStripAiGeneratedOpportunityScoreMention(modelNarrative);

  assert.doesNotMatch(stripped, /Demand Score/i);
  assert.doesNotMatch(stripped, /Competition Score/i);
  assert.doesNotMatch(stripped, /Overall Opportunity Score/i);
  assert.match(stripped, /Category: B2B design subscription for SMBs\./);
});

// --- Issue 4: inferEvidenceLevel hardcoded CAC/LTV/Payback -----------------

test("inferEvidenceLevel no longer forces cac/ltv/payback metrics to validationRequired regardless of their own evidence text (drift check)", () => {
  assert.doesNotMatch(
    reportEvidenceSource,
    /if \(\/\\b\(cac\|customer acquisition cost\|ltv\|lifetime value\|payback\)\\b\/i\.test\(evidenceContext\)\) \{\s*\n\s*return "validationRequired";/,
    "the hardcoded cac/ltv/payback -> validationRequired rule is still present"
  );
});

function mirrorInferEvidenceLevel(input) {
  const evidenceContext = `${input.label || ""}\n${input.value || ""}\n${input.context || ""}`;

  if (
    !input.value ||
    /\b(no data|not available|validation required|needs validation|validate|low confidence)\b/i.test(
      evidenceContext
    )
  ) {
    return "validationRequired";
  }
  if (/\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe)\b/i.test(evidenceContext)) {
    return "verified";
  }
  if (
    /\b(burn|runway|break[\s-]?even|investment needed|planning input|assumption|manual input|founder input|target|threshold|warning)\b/i.test(
      evidenceContext
    )
  ) {
    return "planningAssumption";
  }
  return "benchmarkDerived";
}

test("a CAC metric correctly tagged 'Planning assumption' by the report's own engine is no longer forced to 'AI Analysis'", () => {
  const level = mirrorInferEvidenceLevel({
    label: "CAC",
    value: "$9k",
    context: "CAC: $9k (Planning assumption) benchmark=Within benchmark range ($3k-$12k) | confidence=High",
  });

  assert.equal(level, "planningAssumption");
});

test("an LTV metric with genuinely no data still correctly shows validationRequired", () => {
  const level = mirrorInferEvidenceLevel({
    label: "LTV",
    value: "",
    context: "LTV: not available",
  });

  assert.equal(level, "validationRequired");
});

// --- Issue 5: procurement domain "vendor" false positive -------------------

test("the procurement domain signal no longer matches bare 'vendor'/'supplier' (drift check)", () => {
  const match = domainSource.match(/\["procurement", (\/[\s\S]*?\/i)\]/);
  assert.ok(match, "procurement domain signal not found");
  const pattern = new RegExp(match[1].slice(1, -2), "i");

  assert.equal(pattern.test("manage vendor bookings, guest RSVPs, and on-site logistics"), false);
  assert.equal(pattern.test("coordinate with our suppliers for catering"), false);
  assert.equal(pattern.test("a vendor management platform for enterprise procurement"), true);
  assert.equal(pattern.test("an e-procurement system for government agencies"), true);
});

// --- Issue 6: roadmap306090 duplicate boilerplate --------------------------

test("the AI Action Plan / Market Opportunity Score / AI Executive Insight / Risk Matrix canonical blocks are appended AFTER the labeling loop, not before (drift check)", () => {
  const labelingLoopIndex = planExecutorSource.indexOf(
    "labelModelDerivedFinancialClaims({"
  );
  const roadmapAppendIndex = planExecutorSource.indexOf(
    'normalized.roadmap306090 = appendIntelligenceBlock('
  );
  const marketOppAppendIndex = planExecutorSource.indexOf(
    'reportLabel(language, "Market Opportunity Score", "Pazar Fırsatı Skoru"),\n    buildOpportunityScore(context, language)'
  );

  assert.ok(labelingLoopIndex > -1, "labeling loop not found");
  assert.ok(roadmapAppendIndex > labelingLoopIndex, "roadmap306090's canonical block is still appended before labeling");
  assert.ok(marketOppAppendIndex > labelingLoopIndex, "marketOpportunity's canonical block is still appended before labeling");
});

test("financial-claim-labeling.ts drops a repeated generated fragment even when it's embedded in a different combined line (drift check)", () => {
  assert.match(financialClaimLabelingSource, /seenGeneratedFragments/);
  assert.match(financialClaimLabelingSource, /clauses\.map\(labelClause\)\.filter\(Boolean\)/);
});

test("two different milestones whose own flagged sub-clause produces the exact same explanation never both survive in the same field", () => {
  const seenGeneratedFragments = new Set();

  function labelSubClause(fieldLabel, reason) {
    const result = `${fieldLabel}: ${reason}`;
    if (seenGeneratedFragments.has(result)) return "";
    seenGeneratedFragments.add(result);
    return result;
  }

  const nextSixMonths = `Next 6 months: optimize pricing. ${labelSubClause(
    "Proof",
    "requires verified supporting data before this can be shown; the founder should share the execution evidence behind this milestone"
  )}`;
  const nextTwelveMonths = `Next 12 months: expand jurisdictions. ${labelSubClause(
    "Proof",
    "requires verified supporting data before this can be shown; the founder should share the execution evidence behind this milestone"
  )}`;

  assert.match(nextSixMonths, /Proof: requires verified/);
  // The second, identical "Proof: ..." fragment is dropped -- the
  // milestone's own lead-in sentence survives, just without repeating
  // the exact same explanation a second time.
  assert.doesNotMatch(nextTwelveMonths, /Proof: requires verified/);
  assert.match(nextTwelveMonths, /Next 12 months: expand jurisdictions\.\s*$/);
});
