import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import {
  formatExecutiveDecisionBrief,
  localizeExecutiveDecision,
  extractGenericDecisionSignal,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import { buildEvidenceSummary } from "../app/lib/report-engine/evidence-summary.ts";
import {
  stripFillerAndDuplicateSentences,
  computeFillerRatio,
} from "../app/lib/report-engine/filler-detection.ts";
import { buildMarketExecutiveDecisionBrief } from "../app/lib/report-engine/market-intelligence-presentation.ts";
import {
  normalizePdfSourceContent,
  normalizePdfFinancialSectionContent,
} from "../app/lib/pdf-normalization.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// executive-quality-gate.ts has one REAL (non-type-only) "@/"-aliased
// import, so plain `node --test` can't resolve it directly (no path-alias
// loader is registered for npm test). Rather than adding new loader
// infrastructure to the committed test run, this rewrites that one
// specifier to an absolute file:// path pointing at the real source file
// and imports the result from a throwaway temp file -- real functional
// coverage of the gate's combined logic, no persisted scratch script.
async function importExecutiveQualityGate() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/executive-quality-gate.ts");
  const fillerDetectionPath = join(repoRoot, "app/lib/report-engine/filler-detection.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/filler-detection"',
    JSON.stringify(pathToFileURL(fillerDetectionPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-eqg-"));
  const outPath = join(dir, "executive-quality-gate.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const marketAnalysisSource = readFileSync(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const reportQualityDirectivesSource = readFileSync(
  new URL("../app/lib/ai/report-quality-directives.ts", import.meta.url),
  "utf8"
);
const planPromptSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/plan.ts", import.meta.url),
  "utf8"
);
const marketPromptSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
  "utf8"
);
const domainAnalysisPromptSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/domain-analysis.ts", import.meta.url),
  "utf8"
);
const reportPdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

// -- executive-decision-brief.ts -------------------------------------------

test("formatExecutiveDecisionBrief renders the single Executive Decision layer in order and caps reasons/risks/factors/gaps at 3", () => {
  const brief = {
    decision: "GO",
    confidence: 72,
    confidenceDirection: "supported",
    confidenceFactors: ["Factor one", "Factor two", "Factor three", "Factor four"],
    why: "The single biggest upside is repeat demand.",
    topReasons: ["Reason one", "Reason two", "Reason three", "Reason four"],
    topRisks: ["Risk one", "Risk two", "Risk three", "Risk four"],
    missingEvidence: ["Gap one", "Gap two", "Gap three", "Gap four"],
    whatWouldChangeThisDecision: "New verified competitor data would change this.",
    immediateNextAction: "Begin execution immediately.",
  };

  const rendered = formatExecutiveDecisionBrief(brief, "English");
  assert.match(rendered, /^Executive Decision/);
  assert.match(rendered, /Decision: GO \(Confidence: 72%\)/);
  assert.match(rendered, /Why: The single biggest upside is repeat demand\./);
  assert.match(rendered, /What Would Change This Decision: New verified competitor data would change this\./);
  assert.match(rendered, /Immediate Next Action: Begin execution immediately\./);
  assert.equal(rendered.includes("Factor four"), false, "must cap confidence factors at 3");
  assert.equal(rendered.includes("Reason four"), false, "must cap reasons at 3");
  assert.equal(rendered.includes("Risk four"), false, "must cap risks at 3");
  assert.equal(rendered.includes("Gap four"), false, "must cap missing-evidence items at 3");
  assert.match(rendered, /Confidence Supported By:\n- Factor one/);
  assert.match(rendered, /1\. Reason one/);
  assert.match(rendered, /3\. Reason three/);
  assert.match(rendered, /What Evidence Is Missing:\n1\. Gap one/);

  // Order matters: Decision/Confidence, Confidence Factors, Why, Top 3
  // Reasons, Top 3 Risks, What Evidence Is Missing, What Would Change
  // This Decision, then Immediate Next Action.
  const confidenceFactorsIndex = rendered.indexOf("Confidence Supported By:");
  const whyIndex = rendered.indexOf("Why:");
  const reasonsIndex = rendered.indexOf("Top 3 Reasons:");
  const risksIndex = rendered.indexOf("Top 3 Risks:");
  const missingEvidenceIndex = rendered.indexOf("What Evidence Is Missing:");
  const whatWouldChangeIndex = rendered.indexOf("What Would Change This Decision:");
  const nextActionIndex = rendered.indexOf("Immediate Next Action:");
  assert.ok(confidenceFactorsIndex < whyIndex);
  assert.ok(whyIndex < reasonsIndex);
  assert.ok(reasonsIndex < risksIndex);
  assert.ok(risksIndex < missingEvidenceIndex);
  assert.ok(missingEvidenceIndex < whatWouldChangeIndex);
  assert.ok(whatWouldChangeIndex < nextActionIndex);
});

test("formatExecutiveDecisionBrief renders an honest default line when the caller has no real confidence factor or evidence gap to report", () => {
  const rendered = formatExecutiveDecisionBrief(
    {
      decision: "GO",
      confidence: 80,
      confidenceDirection: "supported",
      confidenceFactors: [],
      why: "Upside.",
      topReasons: ["Reason one"],
      topRisks: ["Risk one"],
      missingEvidence: [],
      whatWouldChangeThisDecision: "Nothing material.",
      immediateNextAction: "Proceed.",
    },
    "English"
  );
  assert.match(rendered, /no specific factor identified/);
  assert.match(rendered, /No material data gaps were identified/);
});

test("formatExecutiveDecisionBrief localizes every label for Turkish, including the 3-value decision vocabulary", () => {
  const rendered = formatExecutiveDecisionBrief(
    {
      decision: "NO_GO",
      confidence: 30,
      confidenceDirection: "reduced",
      confidenceFactors: ["Eksik faktör bir"],
      why: "Risk fırsattan ağır basıyor.",
      topReasons: ["Neden bir"],
      topRisks: ["Risk bir"],
      missingEvidence: ["Eksik veri bir"],
      whatWouldChangeThisDecision: "Yeni doğrulanmış kanıt bu kararı değiştirir.",
      immediateNextAction: "Bütçe ayırmayın.",
    },
    "Turkish"
  );
  assert.match(rendered, /Yönetici Kararı/);
  assert.match(rendered, /Karar: HAYIR \(Güven: 30%\)/);
  assert.match(rendered, /Güven Şu Nedenlerle Düşürüldü:\n- Eksik faktör bir/);
  assert.match(rendered, /Neden: Risk fırsattan ağır basıyor\./);
  assert.match(rendered, /Eksik Olan Kanıtlar:\n1\. Eksik veri bir/);
  assert.match(rendered, /Bu Kararı Ne Değiştirir: Yeni doğrulanmış kanıt bu kararı değiştirir\./);
  assert.match(rendered, /Acil Sonraki Adım: Bütçe ayırmayın\./);
});

test("localizeExecutiveDecision returns the correct 3-value token per language", () => {
  assert.equal(localizeExecutiveDecision("CONDITIONAL_GO", "German"), "BEDINGTES GO");
  assert.equal(localizeExecutiveDecision("NO_GO", "French"), "NO-GO");
  assert.equal(localizeExecutiveDecision("GO", "Spanish"), "GO");
});

test("extractGenericDecisionSignal resolves conditional/hold language to CONDITIONAL_GO ahead of an unqualified go/no-go verb", () => {
  const { decision } = extractGenericDecisionSignal(
    "We recommend proceeding, but only if the regulator confirms the exemption within 30 days."
  );
  assert.equal(decision, "CONDITIONAL_GO");

  const held = extractGenericDecisionSignal("Hold until the missing filing is verified.");
  assert.equal(held.decision, "CONDITIONAL_GO");
});

test("extractGenericDecisionSignal reads an explicit confidence percentage and defaults to 50 when absent", () => {
  const withConfidence = extractGenericDecisionSignal(
    "The evidence does not support proceeding. Confidence: 82%."
  );
  assert.equal(withConfidence.decision, "NO_GO");
  assert.equal(withConfidence.confidence, 82);

  const withoutConfidence = extractGenericDecisionSignal("This statement names no decision keyword at all.");
  assert.equal(withoutConfidence.confidence, 50);
});

// -- evidence-summary.ts ----------------------------------------------------

test("buildEvidenceSummary groups multi-line citations into distinct sources and classifies categories", () => {
  const raw = [
    "[Verified from external source] Title: Turkey Car Wash Market Report",
    "Publisher: Sector Research Group",
    "Source type: Industry association report",
    "URL: https://example.com/report-1",
    "",
    "[Verified from official source] Title: National Statistics Bulletin",
    "Publisher: Government Statistics Office",
    "URL: https://example.com/gov-1",
    "",
    "[Estimate] Title: Competitor Pricing Snapshot",
    "Publisher: Internal analysis",
    "URL: https://example.com/gov-1",
  ].join("\n");

  const summary = buildEvidenceSummary(raw, "English");
  assert.match(summary, /^Evidence Summary/);
  assert.match(summary, /Industry reports/);
  assert.match(summary, /Government data/);
  // The third citation reuses the second citation's URL, so it must count
  // as the same source, not a new one: 2 distinct sources, not 3.
  assert.match(summary, /2 verified sources used\./);
});

test("buildEvidenceSummary returns the no-evidence copy when no citation lines are present", () => {
  const summary = buildEvidenceSummary("This section has no citations at all.", "German");
  assert.match(summary, /Evidenzübersicht/);
  assert.match(summary, /keine unabhängig überprüfbaren Quellen/);
});

// -- filler-detection.ts -----------------------------------------------------

test("stripFillerAndDuplicateSentences removes hedge/filler and duplicate sentences but preserves mid-sentence usage", () => {
  const content = [
    "It is important to note that the market is competitive.",
    "Revenue growth depends on channel mix and pricing discipline this year.",
    "There are many factors that could affect this outcome.",
    "Revenue growth depends on channel mix and pricing discipline this year.",
    "The core recommendation is to enter the northern region first.",
  ].join("\n");

  const stripped = stripFillerAndDuplicateSentences(content);
  assert.equal(stripped.includes("It is important to note"), false);
  assert.equal(stripped.includes("There are many factors"), false);
  assert.match(stripped, /Revenue growth depends on channel mix/);
  assert.match(stripped, /enter the northern region first/);
  const occurrences = stripped.split("Revenue growth depends on channel mix").length - 1;
  assert.equal(occurrences, 1, "the exact duplicate must be removed, keeping only the first");
});

test("computeFillerRatio measures the fraction of filler/duplicate substantive sentences", () => {
  const content = [
    "It is important to note that the market is competitive.",
    "Revenue growth depends on channel mix and pricing discipline this year.",
    "There are many factors that could affect this outcome.",
    "The core recommendation is to enter the northern region first.",
    "Customer retention above ninety percent supports the expansion case.",
  ].join("\n");

  const ratio = computeFillerRatio(content);
  assert.equal(ratio, 2 / 5);
});

// REGRESSION: report-evidence-confidence.ts's formatEvidenceConfidenceBlock
// appends a fixed-template "Evidence & Confidence" block (heading + short
// field labels: Evidence Quality, Confidence Score, Primary Evidence
// Type(s), an optional Missing Evidence line, an optional validation
// recommendation) after EVERY major section. A real, live Market
// Intelligence generation for the Turkish car-wash prompt showed this
// block landing byte-for-byte identical across multiple sections whenever
// they happened to share the same evidence quality/confidence value (the
// same way two rows of a table sharing a value isn't "duplicate prose") --
// but computeFillerRatio's exact-duplicate-line check had no way to tell
// a repeated STRUCTURAL label from a repeated narrative sentence, so a
// well-formed, non-repetitive report was rejected by the executive
// quality gate's 15% filler ceiling for the sole reason that it
// consistently labeled its own evidence quality. Both functions must
// treat this specific block as structural, not filler, regardless of how
// many sections it repeats across.
const repeatedEvidenceConfidenceBlock = [
  "Evidence & Confidence",
  "- Evidence Quality: Medium",
  "- Confidence Score: 62/100",
  "- Primary Evidence Type(s): Benchmark Data",
  "- This section's conclusion relies primarily on Benchmark Data.",
].join("\n");

test("computeFillerRatio never counts the repeated Evidence & Confidence template block as filler", () => {
  const sections = Array.from(
    { length: 6 },
    (_, i) =>
      `Market section ${i} makes a distinct, substantive claim about demand, pricing, or competitive dynamics that is unique to this section.\n\n${repeatedEvidenceConfidenceBlock}`
  );
  const combined = sections.join("\n\n");

  const ratio = computeFillerRatio(combined);
  assert.ok(
    ratio < 0.15,
    `expected the repeated structural block alone to stay under the 15% gate ceiling, got ${ratio}`
  );
});

test("computeFillerRatio still flags genuine repeated PROSE outside the Evidence & Confidence block", () => {
  const content = [
    "The same exact narrative sentence about market demand appears twice in this report.",
    repeatedEvidenceConfidenceBlock,
    "",
    "The same exact narrative sentence about market demand appears twice in this report.",
    repeatedEvidenceConfidenceBlock,
  ].join("\n");

  const ratio = computeFillerRatio(content);
  assert.ok(
    ratio > 0,
    "a genuinely duplicated narrative sentence outside the structural block must still count"
  );
});

test("stripFillerAndDuplicateSentences preserves every line of a repeated Evidence & Confidence block", () => {
  const content = [
    "First section narrative with unique content about the market.",
    repeatedEvidenceConfidenceBlock,
    "",
    "Second section narrative with different unique content about competition.",
    repeatedEvidenceConfidenceBlock,
  ].join("\n");

  const stripped = stripFillerAndDuplicateSentences(content);
  const occurrences = stripped.split("Evidence & Confidence").length - 1;
  assert.equal(occurrences, 2, "both sections' structural blocks must survive intact, not be deduped away");
  assert.match(stripped, /Confidence Score: 62\/100[\s\S]*Confidence Score: 62\/100/);
});

test("REGRESSION: a realistic multi-section report with the Evidence & Confidence block repeated across sections passes the executive quality gate", async () => {
  const { runExecutiveQualityGate } = await importExecutiveQualityGate();

  const sections = {
    executiveSummary:
      "Executive Recommendation\nDecision: WAIT (Confidence: 62%)\nMarket confidence is 62/100, driven mainly by structural demand growth.\n\nTop Reasons:\n1. Unaddressed demand gap in appointment-based service\n\nTop Risks:\n1. Water-use restrictions may tighten",
    marketOverview: `The Turkish car wash market is structurally attractive for focused entrants with clear demand drivers.\n\n${repeatedEvidenceConfidenceBlock}`,
    marketSize: `The market is estimated at 8 billion TL in 2024 with a fragmented competitive structure.\n\n${repeatedEvidenceConfidenceBlock}`,
    industryTrends: `Industry trends favor convenience and compliance-focused operating models.\n\n${repeatedEvidenceConfidenceBlock}`,
    competitiveLandscape: `Regional chains and independents dominate with no single operator above 8 percent share.\n\n${repeatedEvidenceConfidenceBlock}`,
    sources: "Evidence Summary\nNo independently verifiable sources were available for this section.",
  };

  const failures = runExecutiveQualityGate({
    sections,
    firstField: "executiveSummary",
    sourceFields: ["sources"],
  });

  assert.deepEqual(
    failures.filter((f) => f.check === "filler_ceiling"),
    [],
    `expected no filler_ceiling failure from the repeated structural block, got: ${JSON.stringify(failures)}`
  );
});

// -- market-intelligence-presentation.ts: buildMarketExecutiveDecisionBrief -

function fixtureCoverage(overrides = {}) {
  return {
    evidenceCount: 12,
    verifiedSources: 6,
    independentDomains: 5,
    competitorBreadth: 4,
    sourceTypeDiversity: 3,
    claimCoverage: 70,
    freshnessScore: 80,
    averageQuality: 75,
    verifiedMarketSizeAvailable: true,
    dimensions: {
      marketConfidence: 72,
      competitiveEvidence: 65,
      financialEvidence: 60,
      productEvidence: 55,
      executionReadiness: 999,
      founderReadiness: 999,
    },
    overallConfidence: 68,
    sourceClasses: ["market_research", "government_statistics"],
    ...overrides,
  };
}

const marketSectionsFixture = {
  marketOverview: "The Turkish car wash sector is expanding alongside urbanization and vehicle ownership growth.",
  marketDrivers: "Rising vehicle ownership and urban demand are the primary structural growth drivers.",
  opportunities:
    "A largely unaddressed demand gap exists for mobile and appointment-based car wash services in major cities.\nSubscription-based maintenance plans remain untested by incumbent operators in this market.",
  threats:
    "Tightening water-use restrictions could materially increase operating costs across the sector.\nFragmented competition could compress pricing power for new entrants.",
  regionalAnalysis: "Istanbul and Ankara show the highest concentration of unmet demand.",
  strategicRecommendations: "Pilot two locations in the highest-demand districts before scaling regionally.",
};

test("buildMarketExecutiveDecisionBrief maps ENTER/MONITOR/AVOID onto GO/CONDITIONAL_GO/NO_GO and produces a distinct why/topReasons/immediateNextAction", () => {
  const enterBrief = buildMarketExecutiveDecisionBrief(
    marketSectionsFixture,
    "English",
    fixtureCoverage()
  );
  assert.equal(enterBrief.decision, "GO");
  // topReasons[0] is the single best opportunity line; the remaining slots
  // must be genuinely different sentences, never a repeat of it.
  assert.equal(enterBrief.topReasons.length, 2);
  assert.equal(new Set(enterBrief.topReasons).size, enterBrief.topReasons.length);
  assert.equal(enterBrief.topRisks.length, 2);
  assert.ok(enterBrief.why, "why must be a non-empty synthesis sentence");
  assert.ok(enterBrief.immediateNextAction, "immediateNextAction must be a non-empty single sentence");
  assert.ok(enterBrief.whatWouldChangeThisDecision, "whatWouldChangeThisDecision must be a non-empty sentence");
  assert.ok(["reduced", "supported"].includes(enterBrief.confidenceDirection));
  assert.ok(Array.isArray(enterBrief.confidenceFactors));
  assert.ok(Array.isArray(enterBrief.missingEvidence));
  // GO must never contain NO_GO's evidence-gathering/no-commit language.
  assert.doesNotMatch(enterBrief.immediateNextAction, /do not commit/i);

  const avoidBrief = buildMarketExecutiveDecisionBrief(
    marketSectionsFixture,
    "English",
    fixtureCoverage({
      dimensions: {
        marketConfidence: 10,
        competitiveEvidence: 10,
        financialEvidence: 10,
        productEvidence: 10,
        executionReadiness: 999,
        founderReadiness: 999,
      },
    })
  );
  assert.equal(avoidBrief.decision, "NO_GO");
  // NO_GO must never recommend piloting, scaling, entering, or proceeding.
  assert.doesNotMatch(avoidBrief.immediateNextAction, /\b(?:pilot|scale|enter|proceed|execution)\b/i);
  assert.match(avoidBrief.immediateNextAction, /do not commit/i);

  const monitorBrief = buildMarketExecutiveDecisionBrief(
    marketSectionsFixture,
    "English",
    fixtureCoverage({
      dimensions: {
        marketConfidence: 50,
        competitiveEvidence: 50,
        financialEvidence: 50,
        productEvidence: 50,
        executionReadiness: 999,
        founderReadiness: 999,
      },
    })
  );
  assert.equal(monitorBrief.decision, "CONDITIONAL_GO");
});

// -- executive-quality-gate.ts (real functional import via alias rewrite) --

test("executive quality gate passes a well-formed decision-first report and fails a report that dumps information", async () => {
  const { runExecutiveQualityGate, assertExecutiveQualityGate, ExecutiveQualityGateError } =
    await importExecutiveQualityGate();

  const goodSections = {
    executiveSummary:
      "Executive Recommendation\nDecision: GO (Confidence: 72%)\nThis market should be entered now given strong structural demand.\n\nTop Reasons:\n1. Structural demand growth\n2. Defensible pricing power\n3. Low competitive intensity\n\nTop Risks:\n1. Regulatory tightening\n2. Water-cost inflation\n3. New entrant competition",
    marketOverview: "The market shows sustained structural demand growth across major urban centers this year.",
    sources: "Evidence Summary\nVerified against:\n• Industry reports\n\n2 verified sources used.",
  };

  assert.deepEqual(
    runExecutiveQualityGate({ sections: goodSections, firstField: "executiveSummary", sourceFields: ["sources"] }),
    []
  );
  assert.doesNotThrow(() =>
    assertExecutiveQualityGate({ sections: goodSections, firstField: "executiveSummary", sourceFields: ["sources"] })
  );

  const badSections = {
    executiveSummary: "This report discusses the market at length without ever stating a decision or a confidence level.",
    marketOverview:
      "See https://a.example.com and https://b.example.com and https://c.example.com and https://d.example.com for more detail.",
    sources: "Evidence Summary\n2 verified sources used.",
  };

  const failures = runExecutiveQualityGate({
    sections: badSections,
    firstField: "executiveSummary",
    sourceFields: ["sources"],
  });
  const checks = failures.map((failure) => failure.check);
  assert.ok(checks.includes("executive_decision_first"));
  assert.ok(checks.includes("no_long_source_lists"));

  assert.throws(
    () =>
      assertExecutiveQualityGate({
        sections: badSections,
        firstField: "executiveSummary",
        sourceFields: ["sources"],
      }),
    ExecutiveQualityGateError
  );
});

test("REGRESSION: page_one_readable_in_30_seconds must judge only the opening excerpt, not the whole first field -- a long-but-decision-first field must still pass", async () => {
  const { runExecutiveQualityGate } = await importExecutiveQualityGate();

  // Reproduces the production break: a decision-first opening followed by
  // substantial legitimate supporting content (Bottom Line, multiple Key
  // Findings, a confidence rollup, a source reliability overview) that
  // pushes the FULL field comfortably past 600 words -- exactly the shape
  // Market Intelligence's executiveSummary has once the brief, the market
  // summary, the confidence rollup, and the source overview are all
  // concatenated into it. This must never fail the gate: the opening
  // (Decision + Confidence + short answer + reasons/risks) is what has to
  // be readable in 30 seconds, not everything appended after it.
  const opening =
    "Executive Recommendation\nDecision: GO (Confidence: 68%)\nMarket confidence is 68/100, driven mainly by structural demand growth.\n\nTop Reasons:\n1. Unaddressed demand gap in appointment-based service\n2. Favorable regulatory trajectory\n3. Fragmented, low-barrier competitive set\n\nTop Risks:\n1. Water-use restrictions may tighten\n2. New entrants could compress pricing\n3. Supply-chain cost inflation for equipment";
  const longTail = Array.from(
    { length: 40 },
    (_, i) => `Supporting finding number ${i + 1} adds one additional distinct piece of market evidence to the record.`
  ).join(" ");
  const longFirstField = `${opening}\n\n${longTail}`;

  assert.ok(
    longFirstField.trim().split(/\s+/).length > 600,
    "fixture must reproduce a field comfortably over 600 words to prove the whole-field measurement would have failed it"
  );

  const failures = runExecutiveQualityGate({
    sections: { executiveSummary: longFirstField, sources: "Evidence Summary\n2 verified sources used." },
    firstField: "executiveSummary",
    sourceFields: ["sources"],
  });

  assert.equal(
    failures.some((failure) => failure.check === "page_one_readable_in_30_seconds"),
    false,
    `expected no page_one_readable_in_30_seconds failure, got: ${JSON.stringify(failures)}`
  );
});

test("page_one_readable_in_30_seconds still fails when the OPENING itself (not later content) is bloated", async () => {
  const { runExecutiveQualityGate } = await importExecutiveQualityGate();

  // Short, dense filler so 260 words comfortably fits inside the same
  // ~1,100-character opening-excerpt window the gate itself inspects --
  // otherwise the fixture wouldn't actually reproduce a bloated opening.
  const bloatedOpeningWords = Array.from({ length: 260 }, () => "a").join(" ");
  const bloatedOpening = `Executive Recommendation\nDecision: GO (Confidence: 68%)\n${bloatedOpeningWords}`;

  const failures = runExecutiveQualityGate({
    sections: { executiveSummary: bloatedOpening },
    firstField: "executiveSummary",
    sourceFields: [],
  });

  assert.ok(failures.some((failure) => failure.check === "page_one_readable_in_30_seconds"));
});

// -- Wiring: plan-executor.ts (Business Plan + Strategic Advisory) --------

test("plan-executor.ts wires the single Executive Decision layer, evidence summary, filler stripping, and quality gate for Business Plan", () => {
  assert.match(planExecutorSource, /import\s*\{\s*\n?\s*formatExecutiveDecisionBrief/);
  assert.match(planExecutorSource, /buildPlanExecutiveDecisionBrief\(/);
  assert.match(
    planExecutorSource,
    /const planExecutiveDecisionBrief = buildPlanExecutiveDecisionBrief\(context, language\);\s*\n\s*normalized\.executiveSummary = formatExecutiveDecisionBrief\(planExecutiveDecisionBrief, language\);/
  );
  // Single decision layer: no scorecard, confidence rollup, or source
  // overview may be appended to executiveSummary after the brief.
  assert.doesNotMatch(planExecutorSource, /buildExecutiveScorecard/);
  assert.doesNotMatch(planExecutorSource, /buildExecutiveSummaryConfidenceRollup/);
  assert.doesNotMatch(planExecutorSource, /buildSourceReliabilityOverview/);
  assert.match(
    planExecutorSource,
    /normalized\.sourcesAssumptions = buildEvidenceSummary\(\s*\n\s*cleanInternalSourceFallbacks\(normalized\.sourcesAssumptions, language\),\s*\n\s*language\s*\n\s*\);/
  );
  assert.match(planExecutorSource, /stripFillerAndDuplicateSentences\(normalized\[field\]\)/);
  assert.match(
    planExecutorSource,
    /assertExecutiveQualityGate\(\{\s*\n\s*sections: deduped,\s*\n\s*firstField: "executiveSummary"/
  );
});

test("plan-executor.ts wires the Executive Decision brief onto Strategic Advisory's first schema field (subjectIdentification) using a text-derived decision signal", () => {
  assert.match(planExecutorSource, /extractGenericDecisionSignal/);
  assert.match(planExecutorSource, /buildDomainAnalysisExecutiveDecisionBrief\(/);
  assert.match(
    planExecutorSource,
    /const domainExecutiveDecisionBrief = buildDomainAnalysisExecutiveDecisionBrief\(validated, language\);\s*\n\s*validated\.subjectIdentification = \[\s*\n\s*formatExecutiveDecisionBrief\(domainExecutiveDecisionBrief, language\)/
  );
  assert.match(planExecutorSource, /validated\.sources = buildEvidenceSummary\(validated\.sources, language\)/);
  assert.match(
    planExecutorSource,
    /assertExecutiveQualityGate\(\{\s*\n\s*sections: validated,\s*\n\s*firstField: "subjectIdentification"/
  );
});

// -- Wiring: market-analysis/route.ts (Market Intelligence) ----------------

test("market-analysis/route.ts wires the single Executive Decision layer, evidence summary, filler stripping, and quality gate", () => {
  assert.match(marketAnalysisSource, /buildMarketExecutiveDecisionBrief/);
  assert.match(
    marketAnalysisSource,
    /marketExecutiveDecisionBrief = buildMarketExecutiveDecisionBrief\(\s*\n\s*normalized,\s*\n\s*language,\s*\n\s*coverage,\s*\n\s*decisionCriticalEvidence\s*\n\s*\);\s*\n(?:.*\n)*?\s*normalized\.executiveSummary = formatExecutiveDecisionBrief\(marketExecutiveDecisionBrief, language, "market"\);/
  );
  // Single decision layer: no confidence rollup or source-reliability
  // overview may be appended to executiveSummary after the brief, and no
  // per-section Evidence & Confidence block is appended to the report body.
  assert.doesNotMatch(marketAnalysisSource, /buildMarketExecutiveSummaryConfidenceRollup/);
  assert.doesNotMatch(marketAnalysisSource, /buildSourceReliabilityOverview/);
  assert.doesNotMatch(marketAnalysisSource, /appendEvidenceConfidenceToMajorMarketSections/);
  // Sources is now a deterministic bibliography built from the verified
  // evidence registry (buildMarketIntelligenceBibliography), not the
  // model's own free-form text -- buildEvidenceSummary is kept only as
  // the fallback for the one case with no graph to build a bibliography
  // from (a cached/degraded report).
  assert.match(
    marketAnalysisSource,
    /deduped\.sources = graph\s*\n\s*\? buildMarketIntelligenceBibliography\(deduped, graph, language\)\s*\n\s*: buildEvidenceSummary\(deduped\.sources, language\);/
  );
  assert.match(marketAnalysisSource, /stripFillerAndDuplicateSentences\(deduped\[field\]\)/);
  // The quality gate no longer runs as a single all-or-nothing assertion:
  // a preliminary, non-throwing read (runExecutiveQualityGate) first lets
  // one weak/thin section (typically an honest "evidence unavailable"
  // explanation, which reads as short and formulaic) degrade to a clearly
  // labeled "Insufficient verified evidence" fallback instead of aborting
  // every other, independently-evidenced section along with it. The real,
  // still-strict assertExecutiveQualityGate call runs last, against the
  // corrected report, so the report still fails outright whenever there
  // genuinely isn't enough evidence to support the overall decision.
  assert.match(
    marketAnalysisSource,
    /if \(marketAssessment\) \{\s*\n\s*const preliminaryFailures = runExecutiveQualityGate\(\{/
  );
  assert.match(
    marketAnalysisSource,
    /check === "every_section_adds_decision_value"/
  );
  assert.match(marketAnalysisSource, /createInsufficientEvidenceFallback\(/);
  // unboundedSourceFields joined sourceFields here once sources became a
  // deterministic, server-built bibliography exempt from the raw-URL
  // ceiling (see the Sources-bibliography regression tests).
  assert.match(marketAnalysisSource, /assertExecutiveQualityGate\(\{\s*\n\s*sections: deduped,\s*\n\s*firstField: "executiveSummary",\s*\n\s*sourceFields: \["sources"\],\s*\n\s*unboundedSourceFields: \["sources"\],\s*\n\s*\}\);\s*\n\s*\}/);
  // REGRESSION: the preliminary degrade-weak-sections pass must run BEFORE
  // assertReportIsolation/assertNoDecisionContradiction, not after. Those
  // two checks scan whatever raw text the model wrote, including its own
  // attempt to explain an evidence gap -- if either one throws on that raw
  // text first, the degradation logic below it never runs at all, and one
  // missing evidence type can still take down the whole report through a
  // gate other than the quality gate. Asserting the source order (not just
  // that both pieces exist somewhere) is what actually protects against
  // that regression.
  const preliminaryGateIndex = marketAnalysisSource.indexOf("const preliminaryFailures = runExecutiveQualityGate(");
  const isolationCallIndex = marketAnalysisSource.indexOf('assertReportIsolation("market_intelligence", deduped)');
  const contradictionCallIndex = marketAnalysisSource.indexOf("assertNoDecisionContradiction(");
  assert.ok(preliminaryGateIndex > -1 && isolationCallIndex > -1 && contradictionCallIndex > -1);
  assert.ok(preliminaryGateIndex < isolationCallIndex);
  assert.ok(preliminaryGateIndex < contradictionCallIndex);
});

// REGRESSION: filler-stripping used to run on `normalized` BEFORE
// dedupeReportParagraphsAcrossSections and runConsistencyValidationPass --
// so it only ever cleaned the model's own raw draft and never saw the
// content those later steps append/rewrite. A real generation showed
// exactly this: duplication introduced by the pipeline's own later stages
// went unstripped and tripped the filler gate on good content. It must
// run last, against `deduped`, immediately before the isolation/quality-
// gate checks.
test("filler-stripping in market-analysis/route.ts runs last, after dedup and consistency correction, not on the model's raw draft", () => {
  const pipelineOrder = [
    "dedupeReportParagraphsAcrossSections(normalized",
    "runConsistencyValidationPass({",
    "deduped[field] = stripFillerAndDuplicateSentences(deduped[field]);",
    'assertReportIsolation("market_intelligence", deduped);',
  ];
  let searchFrom = 0;
  for (const marker of pipelineOrder) {
    const index = marketAnalysisSource.indexOf(marker, searchFrom);
    assert.ok(index !== -1, `expected to find "${marker}" after position ${searchFrom}`);
    searchFrom = index + marker.length;
  }
});

// -- Prompt directives: executive-consultant tone / financial-first --------

test("report-quality-directives.ts exports a genuinely shared executive-consulting-style directive set covering tone, sources-invisible, and section-must-answer-a-question rules", () => {
  assert.match(reportQualityDirectivesSource, /export function buildExecutiveConsultingStyleDirectives/);
  assert.match(reportQualityDirectivesSource, /According to/);
  assert.match(reportQualityDirectivesSource, /answer one specific executive question/);
  assert.match(reportQualityDirectivesSource, /Do not enumerate raw source URLs/);
  assert.match(reportQualityDirectivesSource, /Worst\/Expected\/Best Case/);
});

test("all three report prompt builders call buildExecutiveConsultingStyleDirectives", () => {
  assert.match(planPromptSource, /\.\.\.buildExecutiveConsultingStyleDirectives\(\)/);
  assert.match(marketPromptSource, /\.\.\.buildExecutiveConsultingStyleDirectives\(\)/);
  assert.match(domainAnalysisPromptSource, /\.\.\.buildExecutiveConsultingStyleDirectives\(\)/);
});

test("domain-analysis.ts asks financialImplications to lead with figures before explanation (Financial First)", () => {
  assert.match(domainAnalysisPromptSource, /financialImplications:\s*\n?\s*"Lead with the compact supported figures/);
});

// -- REGRESSION: PDF rendering of the compressed Evidence Summary ----------

test("REGRESSION: ReportPdfButton.tsx must render the Evidence Summary as-is instead of substituting a fabricated generic placeholder", () => {
  // parseCitations never recognizes the Evidence Summary shape (no
  // title/publisher/URL lines, no "Org — Title" dash pattern), so without
  // a dedicated check, formatPdfCitationContent's citations.length === 0
  // branch would silently replace every report's real, computed Evidence
  // Summary with a hardcoded, unrelated placeholder ("Market Comparisons /
  // Financial Comparisons / Planning Assumptions / Validation Required").
  // This must be intercepted before that fallback runs.
  assert.match(reportPdfButtonSource, /function isEvidenceSummaryContent/);
  assert.match(reportPdfButtonSource, /evidence summary\|kanıt özeti\|evidenzübersicht/i);
  assert.match(
    reportPdfButtonSource,
    /if \(isEvidenceSummaryContent\(sourceContent\)\) \{\s*\n\s*return sourceContent;\s*\n\s*\}\s*\n\s*\n\s*const citations = parseCitations\(sourceContent\);/
  );
});

test("REGRESSION: an Evidence Summary's heading survives the PDF's source-content normalization pipeline intact", () => {
  const evidenceSummary = [
    "Evidence Summary",
    "Verified against:",
    "• Industry reports",
    "• Government data",
    "",
    "2 verified sources used.",
  ].join("\n");

  const afterFinancial = normalizePdfFinancialSectionContent(evidenceSummary, {
    field: "sourcesAssumptions",
    title: "Sources / Assumptions",
  });
  const afterSource = normalizePdfSourceContent(afterFinancial);

  assert.match(afterSource, /^Evidence Summary/);
  assert.match(afterSource, /Industry reports/);
  assert.match(afterSource, /Government data/);
  assert.match(afterSource, /2 verified sources used\./);
});
