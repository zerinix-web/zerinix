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

// -- executive-decision-brief.ts -------------------------------------------

test("formatExecutiveDecisionBrief renders Decision + Confidence within the first line and caps reasons/risks at 3", () => {
  const brief = {
    shortAnswer: "This opportunity is worth pursuing now.",
    decision: "GO",
    confidence: 72,
    topReasons: ["Reason one", "Reason two", "Reason three", "Reason four"],
    topRisks: ["Risk one", "Risk two", "Risk three", "Risk four"],
  };

  const rendered = formatExecutiveDecisionBrief(brief, "English");
  assert.match(rendered, /^Executive Recommendation/);
  assert.match(rendered, /Decision: GO \(Confidence: 72%\)/);
  assert.match(rendered, /This opportunity is worth pursuing now\./);
  assert.equal(rendered.includes("Reason four"), false, "must cap reasons at 3");
  assert.equal(rendered.includes("Risk four"), false, "must cap risks at 3");
  assert.match(rendered, /1\. Reason one/);
  assert.match(rendered, /3\. Reason three/);
});

test("formatExecutiveDecisionBrief localizes the decision/confidence line for Turkish", () => {
  const rendered = formatExecutiveDecisionBrief(
    {
      shortAnswer: "Bu fırsat şimdi değerlendirilmeli.",
      decision: "NO_GO",
      confidence: 30,
      topReasons: ["Neden bir"],
      topRisks: ["Risk bir"],
    },
    "Turkish"
  );
  assert.match(rendered, /Yönetici Tavsiyesi/);
  assert.match(rendered, /Karar: HAYIR \(Güven: 30%\)/);
});

test("localizeExecutiveDecision returns the correct token per language", () => {
  assert.equal(localizeExecutiveDecision("WAIT", "German"), "WARTEN");
  assert.equal(localizeExecutiveDecision("DEPENDS", "French"), "SOUS CONDITIONS");
  assert.equal(localizeExecutiveDecision("GO", "Spanish"), "GO");
});

test("extractGenericDecisionSignal resolves conditional language to DEPENDS ahead of an unqualified go/no-go verb", () => {
  const { decision } = extractGenericDecisionSignal(
    "We recommend proceeding, but only if the regulator confirms the exemption within 30 days."
  );
  assert.equal(decision, "DEPENDS");
});

test("extractGenericDecisionSignal reads an explicit confidence percentage and defaults to 50 when absent", () => {
  const withConfidence = extractGenericDecisionSignal(
    "The evidence does not support proceeding. Confidence: 82%."
  );
  assert.equal(withConfidence.decision, "NO_GO");
  assert.equal(withConfidence.confidence, 82);

  const withoutConfidence = extractGenericDecisionSignal("Hold until the missing filing is verified.");
  assert.equal(withoutConfidence.decision, "WAIT");
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

test("buildMarketExecutiveDecisionBrief maps ENTER/MONITOR/AVOID onto GO/WAIT/NO_GO and surfaces up to 3 reasons and risks", () => {
  const enterBrief = buildMarketExecutiveDecisionBrief(
    marketSectionsFixture,
    "English",
    fixtureCoverage()
  );
  assert.equal(enterBrief.decision, "GO");
  assert.equal(enterBrief.topReasons.length, 2);
  assert.equal(enterBrief.topRisks.length, 2);
  assert.match(enterBrief.shortAnswer, /ENTER this market/);

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
  assert.equal(monitorBrief.decision, "WAIT");
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

// -- Wiring: plan-executor.ts (Business Plan + Strategic Advisory) --------

test("plan-executor.ts wires the Executive Decision brief, evidence summary, filler stripping, and quality gate for Business Plan", () => {
  assert.match(planExecutorSource, /import\s*\{\s*\n?\s*formatExecutiveDecisionBrief/);
  assert.match(planExecutorSource, /buildPlanExecutiveDecisionBrief\(/);
  assert.match(planExecutorSource, /formatExecutiveDecisionBrief\(buildPlanExecutiveDecisionBrief\(context, language\), language\)/);
  assert.match(planExecutorSource, /buildEvidenceSummary\(rawSourcesAssumptions, language\)/);
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
    /validated\.subjectIdentification = \[\s*\n\s*formatExecutiveDecisionBrief\(buildDomainAnalysisExecutiveDecisionBrief\(validated\), language\)/
  );
  assert.match(planExecutorSource, /validated\.sources = buildEvidenceSummary\(validated\.sources, language\)/);
  assert.match(
    planExecutorSource,
    /assertExecutiveQualityGate\(\{\s*\n\s*sections: validated,\s*\n\s*firstField: "subjectIdentification"/
  );
});

// -- Wiring: market-analysis/route.ts (Market Intelligence) ----------------

test("market-analysis/route.ts wires the Executive Decision brief, evidence summary, filler stripping, and quality gate", () => {
  assert.match(marketAnalysisSource, /buildMarketExecutiveDecisionBrief/);
  assert.match(
    marketAnalysisSource,
    /formatExecutiveDecisionBrief\(buildMarketExecutiveDecisionBrief\(normalized, language, coverage\), language\)/
  );
  assert.match(marketAnalysisSource, /normalized\.sources = buildEvidenceSummary\(rawSources, language\)/);
  assert.match(marketAnalysisSource, /stripFillerAndDuplicateSentences\(normalized\[field\]\)/);
  assert.match(
    marketAnalysisSource,
    /if \(marketAssessment\) \{\s*\n\s*assertExecutiveQualityGate\(\{/
  );
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
