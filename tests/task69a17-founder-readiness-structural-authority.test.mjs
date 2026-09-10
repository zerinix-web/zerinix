// TASK #69A-17 -- Make Founder Readiness structurally authoritative and
// eliminate score drift.
//
// OBSERVED BUG: a fresh real Business Idea Validation PDF showed the
// Founder Readiness dimension CARDS (Idea Quality 48, Market
// Attractiveness 54, Business Model Quality 60, Validation Confidence
// 66, Execution Complexity 34, Evidence Confidence 40, Founder Evidence
// 40) disagreeing with the explanatory TEXT immediately below them
// (Idea Quality 48, Market Attractiveness 48, Business Model Quality 54,
// Validation Confidence 60, Execution Complexity 66, Evidence Confidence
// 34, Founder Evidence 40) -- from "Market Attractiveness" onward, the
// text's number for dimension i matches the CARD's number for dimension
// i-1, the exact signature of two independent extractors reading the
// same underlying prose and not reliably agreeing.
//
// ROOT CAUSE (traced, not guessed): investment-score.ts's teamFounder
// category has always exposed its 6 underlying dimension figures ONLY as
// a plain `reasoning: string[]` array of "Label: NN%" lines. TWO
// completely independent regex implementations then re-derive NUMBERS
// from that same prose:
//   1. plan-executor.ts's buildCanonicalFounderScore (extractReasoningScore)
//      -- an UN-ANCHORED regex.exec() against the array joined with " | ",
//      used to WRITE the persisted founderScore section's own text.
//   2. report-presentation.ts's readFounderReasoningScore -- a PER-LINE,
//      start-anchored regex, used as investmentScore's fallback inside
//      readFounderReadinessMetrics/readFounderReadinessMetricValue, the
//      function every renderer's CARD score already calls.
// Two independently-written parsers over the same prose have no
// structural guarantee of ever agreeing -- exactly the class of defect
// #69A-5/#69A-6/#69A-8 already had to fix for adjacent instances of this
// same underlying weakness, and exactly what produced this ticket's
// card/text mismatch.
//
// FIX: investment-score.ts now ALSO computes a genuinely structured,
// zero-regex FounderReadinessDimensionScoreEntry[] (decisionEngine.
// founderScore.dimensionScores) directly from the SAME source variables
// the `reasoning` strings are built from -- additive, so every existing
// persisted report (and every existing test) is unaffected. Every
// consumer of a Founder Readiness dimension's NUMBER -- the text
// generator (buildCanonicalFounderScore) AND every renderer's card
// resolver (readFounderReadinessMetricValue/readFounderReadinessMetrics)
// -- now reads THIS SAME structured array FIRST, whenever it is present,
// with the pre-existing prose/reasoning-regex chain demoted to a
// legacy-only fallback for reports persisted before this field existed.
// Since the text and the cards are now built from the identical source
// value, they cannot diverge for any report generated after this fix.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUNDER_READINESS_DIMENSIONS,
  FOUNDER_READINESS_DIMENSION_METRICS,
  getFounderReadinessDimensionScore,
  readFounderReadinessMetricValue,
  readFounderReadinessMetrics,
} from "../app/lib/report-presentation.ts";
import { createInvestmentScore } from "../app/lib/ai/investment-score.ts";
import { createFinancialModel } from "../app/lib/ai/financial-model.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const investmentScoreSource = readFileSync(join(repoRoot, "app/lib/ai/investment-score.ts"), "utf8");
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");

// The exact real MONITOR/48%-confidence fixture #69A-8 already
// established and locked in with its own regression coverage -- reused
// here verbatim (never re-typed) so this ticket's own requirement G
// ("decision/confidence must remain MONITOR/48% for the current fixture")
// is checked against the SAME values the rest of the session's Founder
// Readiness tickets already anchor to.
const REAL_DIMENSION_VALUES = {
  ideaQuality: 48,
  marketAttractiveness: 48,
  businessModelQuality: 54,
  validationConfidence: 60,
  executionComplexity: 66,
  evidenceConfidence: 34,
  founderEvidence: 40,
};

const LEGACY_INVESTMENT_SCORE = {
  totalScore: 46,
  confidence: 48,
  recommendation: "WAIT", // localizes to "MONITOR" for business_plan reports (Task #69A-7)
  decisionEngine: {
    founderScore: {
      score: 40,
      maximumScore: 100,
      reasoning: [
        "Market attractiveness: 48%",
        "Business model quality: 54%",
        "Validation confidence: 60%",
        "Execution complexity: 66%",
        "Evidence confidence: 34%",
        "Founder evidence: 40%",
      ],
      // Deliberately NO dimensionScores -- this fixture represents a
      // report persisted BEFORE Task #69A-17, proving the new code
      // degrades to the exact pre-existing, unmodified behavior.
    },
  },
};

const LEGACY_FOUNDER_SCORE_TEXT = [
  "Founder Readiness Score: 40/100",
  "Idea Quality: 48/100 - clear market need and timing for AI-enabled FP&A in SMBs.",
  "Market Attractiveness: 48/100 - The market appears attractive if reachable demand and an obtainable beachhead can be validated.",
  "Business Model Quality: 54/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.",
  "Validation Confidence: 60/100 - early-stage with no paid customers; needs pilot conversions.",
  "Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.",
  "Evidence Confidence: 34/100 - Evidence remains directional until customer, pricing, retention, and acquisition data are observed.",
  "Founder Evidence: 40/100 - no founder/team data provided; increases execution risk.",
].join("\n");

// --- Root cause confirmation ----------------------------------------------

test("root cause confirmation: plan-executor.ts's buildCanonicalFounderScore and report-presentation.ts's readFounderReasoningScore are two independently-written regex extractors over the same reasoning prose (the structural weakness this fix removes)", () => {
  assert.match(reportPresentationSource, /function readFounderReasoningScore\(/);
  assert.match(planExecutorSource, /const extractReasoningScore = \(label: string\) => \{/);
});

// --- Fix proof: investment-score.ts computes a real structured array ----

test("fix proof: createInvestmentScore's real, unmocked output now includes decisionEngine.founderScore.dimensionScores -- 7 keyed entries, one per FOUNDER_READINESS_DIMENSION_METRICS key", () => {
  const financialModel = createFinancialModel({
    prompt: "An AI-powered cash flow forecasting tool for SMB accountants.",
    reportKind: "business_plan",
  });
  const investmentScore = createInvestmentScore({
    prompt: "An AI-powered cash flow forecasting tool for SMB accountants.",
    financialModel,
  });
  const dimensionScores = investmentScore.decisionEngine.founderScore.dimensionScores;

  assert.ok(Array.isArray(dimensionScores));
  assert.equal(dimensionScores.length, 7);
  const keys = dimensionScores.map((entry) => entry.key).sort();
  assert.deepEqual(
    keys,
    ["businessModelQuality", "evidenceConfidence", "executionComplexity", "founderEvidence", "ideaQuality", "marketAttractiveness", "validationConfidence"]
  );
});

test("fix proof: every dimensionScores entry's score matches the SAME numeric value embedded in the reasoning string for that dimension -- proving both are derived from the identical underlying variable, not two independent computations", () => {
  const financialModel = createFinancialModel({
    prompt: "A subscription meal-kit service for busy professionals.",
    reportKind: "business_plan",
  });
  const investmentScore = createInvestmentScore({
    prompt: "A subscription meal-kit service for busy professionals.",
    financialModel,
  });
  const founder = investmentScore.decisionEngine.founderScore;
  const reasoning = founder.reasoning.join(" | ");

  const reasoningLabelByKey = {
    marketAttractiveness: "Market attractiveness",
    businessModelQuality: "Business model quality",
    validationConfidence: "Validation confidence",
    executionComplexity: "Execution complexity",
    evidenceConfidence: "Evidence confidence",
    founderEvidence: "Founder evidence",
  };

  for (const [key, reasoningLabel] of Object.entries(reasoningLabelByKey)) {
    const structuredEntry = founder.dimensionScores.find((entry) => entry.key === key);
    const reasoningMatch = new RegExp(`${reasoningLabel}:\\s*(\\d+)%`, "i").exec(reasoning);
    assert.ok(structuredEntry, `expected a structured entry for ${key}`);
    assert.ok(reasoningMatch, `expected a reasoning line for ${key}`);
    assert.equal(structuredEntry.score, Number(reasoningMatch[1]), `${key}: structured score must match its own reasoning line exactly`);
  }

  // ideaQuality has no independent reasoning line of its own -- by
  // design, it is the exact same value as marketAttractiveness.
  const ideaQuality = founder.dimensionScores.find((entry) => entry.key === "ideaQuality");
  const marketAttractiveness = founder.dimensionScores.find((entry) => entry.key === "marketAttractiveness");
  assert.equal(ideaQuality.score, marketAttractiveness.score);
});

test("fix proof: investment-score.ts's totalScore/confidence computation is untouched by THIS (#69A-17) fix -- dimensionScores is purely additive, attached only to decisionEngine.founderScore", () => {
  assert.doesNotMatch(investmentScoreSource, /founderReadinessDimensionScores[\s\S]{0,200}totalScore\s*=/);
  assert.doesNotMatch(investmentScoreSource, /founderReadinessDimensionScores[\s\S]{0,200}confidence\s*=/);
  // NOTE (superseded in part by #69A-27): the array is still declared
  // exactly once, right after teamFounder, and still attached to
  // founderScore exactly as #69A-17 left it -- never touching
  // marketScore, financialScore, executionScore, riskScore,
  // competitionScore, or technologyScore's own construction. #69A-27
  // added a SEPARATE, later, additive read of this same array
  // (detectFatalBlockers(founderReadinessDimensionScores)) to compute
  // fatalBlockers -- which DOES now influence `recommendation`
  // (deliberately, per #69A-27's own fix: a fatal Founder Readiness
  // dimension must override a would-be GO) -- so this file's own
  // occurrence count is now 3 (declaration, founderScore attachment,
  // fatal-blocker check), not 2. recommendation is intentionally no
  // longer "completely untouched" by code that reads this array --
  // see tests/task69a27-decision-engine-corrections.test.mjs for the
  // full fix-proof and behavioral tests.
  const declarationCount = (investmentScoreSource.match(/founderReadinessDimensionScores/g) || []).length;
  assert.equal(declarationCount, 3, "expected the declaration, the founderScore attachment, and #69A-27's fatal-blocker check");
});

test("fix proof: readFounderReadinessMetrics (the function buildRiskHeatmap's Founder Evidence/Validation Confidence risk classification calls directly) also prefers the structured dimensionScores array over the legacy reasoning regex when both are present", () => {
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: ["Founder evidence: 12%"], // drifted/stale legacy value
        dimensionScores: [{ key: "founderEvidence", label: "Founder Evidence", score: 40 }], // true value
      },
    },
  };
  const metrics = readFounderReadinessMetrics(investmentScore);
  assert.equal(metrics.founderEvidence, 40, "readFounderReadinessMetrics must prefer the structured score over the drifted reasoning line");
});

// --- Requirement A: identical canonical scores across renderers ---------

test("requirement A: readFounderReadinessMetricValue (the function every one of the 3 renderers' cards call) and getFounderReadinessDimensionScore (the PDF's own identity-keyed wrapper) resolve to the IDENTICAL structured value for every dimension, for a report carrying dimensionScores", () => {
  const investmentScoreWithStructure = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: LEGACY_INVESTMENT_SCORE.decisionEngine.founderScore.reasoning,
        dimensionScores: [
          { key: "ideaQuality", label: "Idea Quality", score: 48 },
          { key: "marketAttractiveness", label: "Market Attractiveness", score: 48 },
          { key: "businessModelQuality", label: "Business Model Quality", score: 54 },
          { key: "validationConfidence", label: "Validation Confidence", score: 60 },
          { key: "executionComplexity", label: "Execution Complexity", score: 66 },
          { key: "evidenceConfidence", label: "Evidence Confidence", score: 34 },
          { key: "founderEvidence", label: "Founder Evidence", score: 40 },
        ],
      },
    },
  };

  for (const dimension of FOUNDER_READINESS_DIMENSION_METRICS) {
    const cardValue = readFounderReadinessMetricValue(dimension.label, investmentScoreWithStructure, "");
    const pdfValue = getFounderReadinessDimensionScore(dimension.key, investmentScoreWithStructure, "");
    assert.equal(cardValue, REAL_DIMENSION_VALUES[dimension.key], `${dimension.key}: card value must equal the real dimension value`);
    assert.equal(pdfValue, REAL_DIMENSION_VALUES[dimension.key], `${dimension.key}: PDF value must equal the real dimension value`);
    assert.equal(cardValue, pdfValue, `${dimension.key}: card and PDF must be identical`);
  }
});

// --- The exact reported bug: structured score wins over drifted prose ---

test("THE REPORTED BUG, reproduced and proven fixed: when the persisted TEXT/reasoning prose (if independently re-parsed) would disagree with the true canonical score, readFounderReadinessMetricValue still returns the STRUCTURED value, never the drifted prose value -- this is the exact mechanism that produced cards != text in the real PDF", () => {
  // A deliberately adversarial fixture: the structured array (the TRUE
  // canonical numbers) says Market Attractiveness = 54, but the
  // corresponding text/reasoning line (simulating a report where the two
  // independent regex extractors drifted) says 48 -- reproducing the
  // exact reported symptom where the card and the text disagreed.
  const adversarialInvestmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: ["Market attractiveness: 48%"], // drifted/stale value
        dimensionScores: [{ key: "marketAttractiveness", label: "Market Attractiveness", score: 54 }], // TRUE value
      },
    },
  };
  const adversarialContent = "Market Attractiveness: 48/100 - drifted stale explanatory text.";

  const cardValue = readFounderReadinessMetricValue("Market Attractiveness", adversarialInvestmentScore, adversarialContent);
  assert.equal(cardValue, 54, "the structured canonical score must win over any drifted prose value, proving prose is never trusted when structured data exists");
});

// --- Requirement B: reordering dimensions cannot misalign ---------------

test("requirement B: dimensionScores in REVERSED or SHUFFLED array order still resolves every dimension to its own correct value -- resolution is by key identity, never by array position", () => {
  const orderedEntries = [
    { key: "ideaQuality", label: "Idea Quality", score: 48 },
    { key: "marketAttractiveness", label: "Market Attractiveness", score: 48 },
    { key: "businessModelQuality", label: "Business Model Quality", score: 54 },
    { key: "validationConfidence", label: "Validation Confidence", score: 60 },
    { key: "executionComplexity", label: "Execution Complexity", score: 66 },
    { key: "evidenceConfidence", label: "Evidence Confidence", score: 34 },
    { key: "founderEvidence", label: "Founder Evidence", score: 40 },
  ];
  const reversedEntries = [...orderedEntries].reverse();
  const shuffledEntries = [orderedEntries[3], orderedEntries[0], orderedEntries[5], orderedEntries[1], orderedEntries[6], orderedEntries[2], orderedEntries[4]];

  for (const entries of [orderedEntries, reversedEntries, shuffledEntries]) {
    const investmentScore = {
      decisionEngine: { founderScore: { score: 40, maximumScore: 100, reasoning: [], dimensionScores: entries } },
    };
    for (const dimension of FOUNDER_READINESS_DIMENSION_METRICS) {
      const value = readFounderReadinessMetricValue(dimension.label, investmentScore, "");
      assert.equal(value, REAL_DIMENSION_VALUES[dimension.key], `${dimension.key} must resolve correctly regardless of array order`);
    }
  }
});

// --- Requirement C/D: adjacent dimensions cannot bleed into each other --

test("requirement C: Execution Readiness cannot consume Validation Confidence's (or any other adjacent dimension's) score -- constructed with genuinely distinct, adjacent values and verified independently", () => {
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: [],
        dimensionScores: [
          { key: "validationConfidence", label: "Validation Confidence", score: 60 },
          { key: "executionComplexity", label: "Execution Complexity", score: 66 },
        ],
      },
    },
  };
  const executionComplexity = readFounderReadinessMetricValue("Execution Readiness", investmentScore, "");
  const validationConfidence = readFounderReadinessMetricValue("Validation Confidence", investmentScore, "");
  assert.equal(executionComplexity, 66);
  assert.equal(validationConfidence, 60);
  assert.notEqual(executionComplexity, validationConfidence);
});

test("requirement D: Evidence Confidence cannot consume Execution Readiness's score -- constructed with genuinely distinct, adjacent values and verified independently", () => {
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: [],
        dimensionScores: [
          { key: "executionComplexity", label: "Execution Readiness", score: 66 },
          { key: "evidenceConfidence", label: "Evidence Confidence", score: 34 },
        ],
      },
    },
  };
  const executionComplexity = readFounderReadinessMetricValue("Execution Readiness", investmentScore, "");
  const evidenceConfidence = readFounderReadinessMetricValue("Evidence Confidence", investmentScore, "");
  assert.equal(evidenceConfidence, 34);
  assert.equal(executionComplexity, 66);
  assert.notEqual(evidenceConfidence, executionComplexity);
});

test("requirement 7: dimension ordering (FOUNDER_READINESS_DIMENSION_METRICS' own declared order) is unchanged by this fix -- the underlying key stays \"executionComplexity\" (minimal, safe internal migration), but the user-facing label is now [UPDATED BY #69A-53] \"Execution Readiness\", not \"Execution Complexity\", since the underlying score has always meant higher = easier/more ready, not higher = more complex", () => {
  const keys = FOUNDER_READINESS_DIMENSION_METRICS.map((dimension) => dimension.key);
  assert.deepEqual(keys, [
    "ideaQuality",
    "marketAttractiveness",
    "businessModelQuality",
    "validationConfidence",
    "executionComplexity",
    "evidenceConfidence",
    "founderEvidence",
  ]);
  const executionComplexityDimension = FOUNDER_READINESS_DIMENSIONS.find((d) => d.key === "executionComplexity");
  assert.match(executionComplexityDimension.label, /Readiness/);
  assert.doesNotMatch(executionComplexityDimension.label, /Complexity/);
  // Backward compatibility: the OLD label is still a recognized alias,
  // so a historical report's own persisted "Execution Complexity: NN%"
  // text is still found correctly.
  assert.ok(executionComplexityDimension.aliases.includes("Execution Complexity"));
});

// --- Requirement E: PDF visual score and explanatory sentence agree -----

test("requirement E: buildCanonicalFounderScore (plan-executor.ts) reads the SAME structured dimensionScores array (via resolveDimensionScoreText) that readFounderReadinessMetricValue reads -- the text this function writes and the card score every renderer resolves can never diverge for a report carrying this field", () => {
  assert.match(planExecutorSource, /const founderDimensionScores = Array\.isArray\(founder\.dimensionScores\) \? founder\.dimensionScores : \[\];/);
  assert.match(
    planExecutorSource,
    /const resolveDimensionScoreText = \(key: string, reasoningLabel: string\) => \{\s*\n\s*const structuredEntry = founderDimensionScores\.find\(\(entry\) => entry\?\.key === key\);/
  );
  for (const key of ["marketAttractiveness", "businessModelQuality", "validationConfidence", "executionComplexity", "evidenceConfidence", "founderEvidence", "ideaQuality"]) {
    assert.match(planExecutorSource, new RegExp(`resolveDimensionScoreText\\("${key}"`));
  }
});

test("requirement E: no renderer independently recalculates a Founder Readiness dimension -- all 3 call the shared readFounderReadinessMetricValue/canonical resolver, never a hand-written formula", () => {
  for (const [name, source] of [["Planner.tsx", plannerSource], ["page.tsx", pageSource], ["ReportPdfButton.tsx", pdfButtonSource]]) {
    assert.match(source, /readFounderReadinessMetricValue\(/, `${name} must call the canonical resolver`);
  }
});

// --- Requirement F: missing historical structured data is honest --------

test("requirement F: a legacy report with no dimensionScores field at all degrades to the exact pre-existing text/reasoning-based extraction, unchanged -- never fabricating a score", () => {
  for (const dimension of FOUNDER_READINESS_DIMENSION_METRICS) {
    const value = readFounderReadinessMetricValue(dimension.label, LEGACY_INVESTMENT_SCORE, LEGACY_FOUNDER_SCORE_TEXT);
    assert.equal(value, REAL_DIMENSION_VALUES[dimension.key], `${dimension.key}: legacy fallback must still resolve its real historical value`);
  }
});

test("requirement F: a legacy report missing BOTH dimensionScores and any parseable text/reasoning for a dimension resolves to null, never a fabricated number", () => {
  const emptyInvestmentScore = {
    decisionEngine: { founderScore: { score: 40, maximumScore: 100, reasoning: [] } },
  };
  const value = readFounderReadinessMetricValue("Execution Readiness", emptyInvestmentScore, "");
  assert.equal(value, null);
});

test("requirement F: readFounderReadinessDimensionScore-equivalent structured lookup returns null (not a fallback trigger bypass) for a key not present in a partially-populated dimensionScores array, still falling through to the legacy text path correctly", () => {
  const partialInvestmentScore = {
    decisionEngine: {
      founderScore: {
        score: 40,
        maximumScore: 100,
        reasoning: LEGACY_INVESTMENT_SCORE.decisionEngine.founderScore.reasoning,
        dimensionScores: [{ key: "ideaQuality", label: "Idea Quality", score: 48 }], // only one entry
      },
    },
  };
  assert.equal(readFounderReadinessMetricValue("Idea Quality", partialInvestmentScore, ""), 48);
  // executionComplexity has no structured entry here -- must fall back to
  // the legacy text extraction rather than returning null incorrectly.
  assert.equal(readFounderReadinessMetricValue("Execution Readiness", partialInvestmentScore, LEGACY_FOUNDER_SCORE_TEXT), 66);
});

// --- Requirement G: MONITOR/48% decision fixture unchanged --------------

test("requirement G: the real report's MONITOR (internally \"WAIT\") decision and 48% confidence are completely unaffected by this fix -- Founder Readiness dimension scores are an independent number", () => {
  assert.equal(LEGACY_INVESTMENT_SCORE.confidence, 48);
  assert.equal(LEGACY_INVESTMENT_SCORE.recommendation, "WAIT");
  // Confirmed above (requirement F) that this exact fixture's 7
  // dimension values still resolve identically after this fix.
});

// --- Preserve #69A-15 through #69A-16B (requirement 9) ------------------

test("preserves #69A-15/15A/15B/15C/16/16B: no competitor-landscape, admin/PDF-export-bypass, or unrelated file carries a #69A-17 marker", () => {
  for (const relativePath of [
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/api/usage/pdf-export/route.ts",
    "app/lib/strategic-report-access.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/report-consistency-validation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-17/);
  }
});

test("preserves #69A-16B: pdf-export/route.ts's admin/owner quota exemption is still wired exactly as that ticket left it", () => {
  const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
  assert.match(pdfExportRouteSource, /if \(!permission\.allowed && !isUsageLimitExemptAccount\) \{/);
});

test("preserves competitor-landscape structured generation (#69A-15A/16): BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA and the business-plan schema call site are untouched", () => {
  const businessCompetitorSource = readFileSync(
    join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
    "utf8"
  );
  assert.match(businessCompetitorSource, /export const BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA = \{/);
  // Field-list-tolerant: TASK #69A-28 legitimately appended a second,
  // unrelated schema-enforced key ("portersFiveForcesStructured") to
  // this SAME array.
  assert.match(
    planExecutorSource,
    /format: createFullReportJsonSchema\(\s*\n\s*"zerinix_business_plan_report",\s*\n\s*\[\.\.\.planFields, "competitorLandscapeStructured"(?:, "portersFiveForcesStructured")?\],/
  );
});
