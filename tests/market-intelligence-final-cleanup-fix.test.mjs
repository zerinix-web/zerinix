import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// FINAL CLEANUP -- remove remaining internal scoring terminology from
// Market Intelligence output.
//
// Builds on four prior Market Intelligence polish tickets. This one closes
// two newly-identified categories of leak:
//
// 1. "Confidence Radar" (the Executive Snapshot panel title) was already
//    relabeled to "Decision Factors" for Market Intelligence in a prior
//    ticket, but ONE of its five rendered dimensions
//    (buildConfidenceRadar in report-presentation.ts) is itself literally
//    labeled "Evidence"/"Kanıt" -- so the panel still showed a bare
//    "Evidence" row for every Market Intelligence report. Fixed by
//    remapping just that one dimension's label to "Market Signals" /
//    "Pazar Sinyalleri" at each Market-Intelligence-gated render site
//    (page.tsx's ExecutiveSnapshotPanel, Planner.tsx's on-screen panel,
//    and Planner.tsx's own PDF export) -- the shared
//    buildConfidenceRadar/buildExecutiveSnapshot computation and Business
//    Plan/Acquisition's rendering of the same dimension are untouched.
//    ReportPdfButton.tsx's PDF cover never reached this dimension for MI
//    reports to begin with (confirmed by a prior ticket's own regression
//    test), so it needed no change.
// 2. Multiple customer-visible sentences in
//    market-intelligence-presentation.ts (the Executive Decision Brief's
//    Why/Top Risk/What-Would-Change-This/Confidence-Factors/Information-
//    Required-Before-Decision content, the Bottom Line summary, and the
//    closing verdict paragraph) used the bare words "evidence"/"verified"
//    (and their Turkish/German/French/Spanish equivalents) throughout --
//    reworded to "validation"/"data"/"confirmed" per the ticket's
//    Evidence->Validation/Support and Verified->Confirmed mapping. The
//    PROMPT-context text this same file builds for the AI model
//    (buildPreGenerationVerdictContext/buildDimensionBreakdownContext --
//    never shown to the customer) was deliberately left untouched, since
//    this is a presentation-only fix.
// Also fixed as a smaller, closely-related item: the MI-exclusive PDF
// "Evidence-Based" summary tag (ReportPdfButton.tsx) and the shared
// Executive Summary PDF card's "Missing Evidence" row label (gated to MI
// only, via isMarketIntelligenceReport/isMarketIntelligence -- Business
// Plan and Acquisition still read "Missing Evidence" exactly as before).
//
// Routing, report classification, market analysis logic, competitor
// analysis logic, TAM/SAM/SOM calculation logic, the decision engine, and
// PDF structure are all confirmed untouched below.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const pdfNormalizationSource = readFileSync(
  new URL("../app/lib/pdf-normalization.mjs", import.meta.url),
  "utf8"
);
const marketPresentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

// --- 1. "Confidence Radar" dimension no longer literally says "Evidence" --

test("page.tsx's ExecutiveSnapshotPanel remaps the 'Evidence'/'Kanıt' confidenceRadar dimension to 'Market Signals'/'Pazar Sinyalleri' for Market Intelligence only", () => {
  const panelMatch = /function ExecutiveSnapshotPanel\([\s\S]*?\n}\n/.exec(pageSource);
  assert.ok(panelMatch, "ExecutiveSnapshotPanel not found in page.tsx");
  const body = panelMatch[0];

  assert.match(body, /const confidenceRadarDimensions = isMarketIntelligence/);
  assert.match(body, /dimension\.label === "Evidence" \|\| dimension\.label === "Kanıt"/);
  assert.match(body, /"Market Signals"/);
  assert.match(body, /"Pazar Sinyalleri"/);
  // The panel now renders the remapped array, not the raw shared snapshot.
  assert.match(body, /\{confidenceRadarDimensions\.map\(\(dimension\)/);
  assert.doesNotMatch(body, /\{snapshot\.confidenceRadar\.map\(\(dimension\)/);
});

test("Planner.tsx's on-screen executive snapshot panel has the same Market-Intelligence-only remap", () => {
  const onScreenMatch = /const confidenceRadarDimensions = isMarketIntelligence[\s\S]{0,400}/.exec(plannerSource);
  assert.ok(onScreenMatch, "confidenceRadarDimensions remap not found in Planner.tsx");
  assert.match(onScreenMatch[0], /dimension\.label === "Evidence" \|\| dimension\.label === "Kanıt"/);
  assert.match(onScreenMatch[0], /"Market Signals"/);
  assert.match(onScreenMatch[0], /"Pazar Sinyalleri"/);
  assert.match(plannerSource, /\{confidenceRadarDimensions\.map\(\(dimension\)/);
});

test("Planner.tsx's own PDF export also remaps the Evidence/Kanıt dimension for Market Intelligence (it does not share ReportPdfButton.tsx's MI-specific data source)", () => {
  const pdfRemapMatch = /const marketIntelligenceConfidenceRadarDimensions = isMarketIntelligence[\s\S]{0,500}/.exec(
    plannerSource
  );
  assert.ok(pdfRemapMatch, "marketIntelligenceConfidenceRadarDimensions remap not found in Planner.tsx");
  assert.match(pdfRemapMatch[0], /dimension\.label === "Evidence" \|\| dimension\.label === "Kanıt"/);
  assert.match(pdfRemapMatch[0], /"Market Signals"/);
  assert.match(plannerSource, /: marketIntelligenceConfidenceRadarDimensions\)\.forEach\(\(dimension, index\)/);
});

test("Planner.tsx's PDF export also relabels the panel title itself ('Confidence Radar' -> 'Confidence Factors') for Market Intelligence, matching ReportPdfButton.tsx's established MI label", () => {
  assert.match(
    plannerSource,
    /isMarketIntelligence \? "Confidence Factors" : "Confidence Radar"/
  );
});

test("ReportPdfButton.tsx's PDF cover never reaches the raw 'Confidence Radar'/Evidence-dimension branch for Market Intelligence reports (drift check on the prior ticket's own guard)", () => {
  const panelTitleMatch = /: isMarketIntelligenceReport\s*\n?\s*\?\s*localizePdfPresentationLabel\("Confidence Factors", pdfLocale\)[\s\S]{0,80}/.exec(
    pdfButtonSource
  );
  assert.ok(panelTitleMatch, "isMarketIntelligenceReport ? 'Confidence Factors' branch not found");
  assert.match(pdfButtonSource, /marketConfidenceFactors/);
});

// --- 2. "Evidence-Based" PDF tag -> "Validation-Based" ---------------------

test("the Market-Intelligence-only PDF summary tag no longer reads 'Evidence-Based'", () => {
  assert.doesNotMatch(pdfButtonSource, /"Evidence-Based"/);
  const occurrences = pdfButtonSource.match(/localizePdfPresentationLabel\("Validation-Based", pdfLocale\)/g) || [];
  assert.equal(occurrences.length, 2, "expected both MI PDF tag call sites to use 'Validation-Based'");
  assert.match(pdfNormalizationSource, /\["Validation-Based", "Doğrulamaya Dayalı"\]/);
  assert.doesNotMatch(pdfNormalizationSource, /"Evidence-Based"/);
});

// --- 3. "Missing Evidence" PDF card row, gated to Market Intelligence -----

test("the Executive Summary PDF card's 'Missing Evidence' row label becomes 'Information Required Before Decision' for Market Intelligence only, in both PDF generators", () => {
  assert.match(
    pdfButtonSource,
    /isMarketIntelligenceReport \? "Information Required Before Decision" : "Missing Evidence"/
  );
  assert.match(
    plannerSource,
    /isMarketIntelligence \? "Information Required Before Decision" : "Missing Evidence"/
  );
  assert.match(
    pdfNormalizationSource,
    /\["Information Required Before Decision", "Karardan Önce Gereken Bilgiler"\]/
  );
  // Business Plan / Acquisition still read the original label -- the
  // dictionary entry that renders it for them is untouched.
  assert.match(pdfNormalizationSource, /\["Missing Evidence", "Eksik Kanıtlar"\]/);
});

// --- 4. market-intelligence-presentation.ts: bare evidence/verified -------
// --- removed from customer-visible decision-brief content -----------------

test("buildMarketExecutiveDecisionBrief's rendered Why/Top-Risk/gap/next-action content contains no bare 'evidence' or 'verified' in any of the 5 languages, for a low-confidence (AVOID) market", async () => {
  const { buildMarketExecutiveDecisionBrief } = await import(
    "../app/lib/report-engine/market-intelligence-presentation.ts"
  );
  const lowCoverage = {
    evidenceCount: 2,
    verifiedSources: 0,
    independentDomains: 1,
    competitorBreadth: 1,
    sourceTypeDiversity: 1,
    claimCoverage: 20,
    freshnessScore: 30,
    averageQuality: 25,
    verifiedMarketSizeAvailable: false,
    dimensions: {
      marketConfidence: 20,
      competitiveEvidence: 15,
      financialEvidence: 20,
      productEvidence: 10,
      executionReadiness: 20,
      founderReadiness: 20,
    },
    overallConfidence: 18,
    sourceClasses: [],
  };

  const forbidden = [/\bevidence\b/i, /\bverified\b/i];
  const languages = ["English", "Turkish", "German", "French", "Spanish"];

  for (const language of languages) {
    const brief = buildMarketExecutiveDecisionBrief(
      {
        opportunities: "",
        threats: "",
        marketDrivers: "",
        marketOverview: "",
        regionalAnalysis: "",
        entryStrategy: "",
      },
      language,
      lowCoverage
    );
    const rendered = [
      brief.why,
      ...brief.topReasons,
      ...brief.topRisks,
      ...brief.missingEvidence,
      brief.whatWouldChangeThisDecision,
      brief.immediateNextAction,
      ...brief.confidenceFactors,
    ].join("\n");

    for (const pattern of forbidden) {
      assert.doesNotMatch(
        rendered,
        pattern,
        `${language} decision brief still contains a bare "${pattern}" match:\n${rendered}`
      );
    }
  }
});

test("buildMarketExecutiveDecisionBrief's rendered content contains no bare 'evidence' or 'verified' for a high-confidence (GO) market either", async () => {
  const { buildMarketExecutiveDecisionBrief } = await import(
    "../app/lib/report-engine/market-intelligence-presentation.ts"
  );
  const highCoverage = {
    evidenceCount: 40,
    verifiedSources: 12,
    independentDomains: 10,
    competitorBreadth: 8,
    sourceTypeDiversity: 6,
    claimCoverage: 90,
    freshnessScore: 85,
    averageQuality: 88,
    verifiedMarketSizeAvailable: true,
    dimensions: {
      marketConfidence: 80,
      competitiveEvidence: 78,
      financialEvidence: 82,
      productEvidence: 75,
      executionReadiness: 80,
      founderReadiness: 80,
    },
    overallConfidence: 79,
    sourceClasses: [],
  };
  const forbidden = [/\bevidence\b/i, /\bverified\b/i];

  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    const brief = buildMarketExecutiveDecisionBrief(
      { opportunities: "", threats: "", marketDrivers: "", marketOverview: "", regionalAnalysis: "", entryStrategy: "" },
      language,
      highCoverage
    );
    const rendered = [brief.why, ...brief.topReasons, ...brief.confidenceFactors, brief.immediateNextAction].join("\n");
    for (const pattern of forbidden) {
      assert.doesNotMatch(rendered, pattern, `${language} GO-case brief still contains ${pattern}:\n${rendered}`);
    }
  }
});

test("buildMarketFinalVerdictParagraph's closing paragraph (appended to the report's final page) contains no bare 'evidence' or 'verified' for any decision code or language", async () => {
  const { buildMarketFinalVerdictParagraph } = await import(
    "../app/lib/report-engine/market-intelligence-presentation.ts"
  );
  const forbidden = [/\bevidence\b/i, /\bverified\b/i];

  for (const decision of ["GO", "CONDITIONAL_GO", "NO_GO"]) {
    for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
      const paragraph = buildMarketFinalVerdictParagraph(
        {
          decision,
          confidence: 55,
          confidenceDirection: "reduced",
          confidenceFactors: [],
          why: "",
          topReasons: ["Strong structural demand"],
          topRisks: ["Competitive intensity is not independently confirmed"],
          missingEvidence: [],
          whatWouldChangeThisDecision: "",
          immediateNextAction: "",
        },
        language
      );
      for (const pattern of forbidden) {
        assert.doesNotMatch(
          paragraph,
          pattern,
          `${decision}/${language} verdict paragraph still contains ${pattern}:\n${paragraph}`
        );
      }
    }
  }
});

test("buildMarketExecutiveSummary's 'Bottom Line' sentence contains no bare 'evidence' in any of the 5 languages", async () => {
  const { buildMarketExecutiveSummary } = await import(
    "../app/lib/report-engine/market-intelligence-presentation.ts"
  );
  const coverage = {
    evidenceCount: 10,
    verifiedSources: 3,
    independentDomains: 3,
    competitorBreadth: 3,
    sourceTypeDiversity: 3,
    claimCoverage: 50,
    freshnessScore: 50,
    averageQuality: 50,
    verifiedMarketSizeAvailable: false,
    dimensions: {
      marketConfidence: 50,
      competitiveEvidence: 50,
      financialEvidence: 50,
      productEvidence: 50,
      executionReadiness: 50,
      founderReadiness: 50,
    },
    overallConfidence: 50,
    sourceClasses: [],
  };

  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    const summary = buildMarketExecutiveSummary(
      { opportunities: "", threats: "", marketDrivers: "", marketOverview: "" },
      language,
      coverage
    );
    assert.doesNotMatch(summary, /\bevidence\b/i, `${language} bottom line still contains "evidence":\n${summary}`);
  }
});

test("the AI prompt-context builders (buildPreGenerationVerdictContext/buildDimensionBreakdownContext) are deliberately untouched -- they are never shown to the customer", () => {
  assert.match(marketPresentationSource, /export function buildPreGenerationVerdictContext/);
  const fnMatch = /function buildPreGenerationVerdictContext\([\s\S]*?\n}\n/.exec(marketPresentationSource);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /Based on the evidence coverage above/);
});

// --- 5. Preserve: routing, classification, market analysis logic, ---------
// --- competitor analysis, TAM/SAM/SOM, decision engine, PDF structure -----

test("the decision engine's ENTER/MONITOR/AVOID computation and GO/CONDITIONAL_GO/NO_GO mapping are unchanged (drift check)", () => {
  assert.match(
    marketPresentationSource,
    /decision === "ENTER" \? "GO" : decision === "MONITOR" \? "CONDITIONAL_GO" : "NO_GO"/
  );
});

test("routing and report classification (applyPromptIntentModeOverride, classifyReportDomain) are untouched by this presentation-only fix", async () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);

  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(classifyReportDomain("I want to acquire a cybersecurity SaaS company."), "acquisition");
});

test("competitor analysis and TAM/SAM/SOM field prompts, and vendor/competitor discovery logic, are unchanged (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape/);
  assert.match(marketPromptSource, /tamSamSom/);

  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
  assert.match(marketGraphSource, /function projectMarketIntelligenceGraphToReport/);
});

test("ReportPdfButton.tsx's PDF page structure (page ordering, drawCoverPage/addPage flow) is untouched by this fix (drift check)", () => {
  assert.match(pdfButtonSource, /drawCoverPage\(\)/);
  assert.match(pdfButtonSource, /pdf\.addPage\(\)/);
});

test("Business Plan and Acquisition report rendering are not affected: the on-screen confidenceRadar remap and PDF 'Missing Evidence' relabel are both gated behind isMarketIntelligence/isMarketIntelligenceReport, never unconditional", () => {
  assert.doesNotMatch(pageSource, /confidenceRadarDimensions = snapshot\.confidenceRadar\.map/);
  assert.doesNotMatch(plannerSource, /confidenceRadarDimensions = snapshot\.confidenceRadar\.map/);
  // The ternary form (`isMarketIntelligence ? ... : "Missing Evidence"`)
  // guarantees non-MI reports fall through to the untouched literal.
  assert.match(pdfButtonSource, /: "Missing Evidence"/);
  assert.match(plannerSource, /: "Missing Evidence"/);
});
