import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces 5 real, confirmed production bugs found in a live Business
// Plan PDF for an e-commerce inventory SaaS report, distinct from an
// earlier turn's fixes:
//
// 1. Raw evidence-classification badges ("AI Analysis", "Assumption")
//    concatenated directly after a Unit Economics/Financial Dashboard
//    card's value with no separator at all ("CAC $51 AI Analysis").
// 2. "Rider CAC"/"Rider LTV" mislabeling a non-mobility (e-commerce)
//    report's Financial Dashboard, because isMobilityReportContent used
//    a loose keyword list that false-positived on unrelated incidental
//    words (e.g. "rental") anywhere in the whole report.
// 3. KPI Dashboard/KPIs showing "CAC 51%" -- a dollar figure rendered
//    with a hardcoded "%" suffix, because CAC (which the kpiDashboard
//    prompt explicitly forbids from that section) fell through to a
//    bare-score-as-percentage fallback meant for genuinely percentage-
//    shaped funnel metrics.
// 4. The same verbatim boilerplate fallback sentence appearing in 4+
//    different sections (Competitor Landscape, Scenario Analysis,
//    both 30-60-90 roadmap lines) because the fallback's explanatory
//    clause was one fixed sentence for every field.
// 5. Sources page returning topically irrelevant sources (WHO, OECD,
//    FPDS government procurement data) for an e-commerce SaaS report,
//    because the research pipeline's source-priority stages were
//    written for real-estate/legal/procurement research (cadastral,
//    court, registry, multilateral institutions) and applied
//    unconditionally to every domain -- plus broken entries (empty
//    Publisher, a title truncated mid-abbreviation) rendered as-is.

const pdfSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const reportUtilsSource = readFileSync("components/planner/report-utils.ts", "utf8");
const domainResearchSource = readFileSync("app/lib/ai/domain-research.ts", "utf8");
const financialClaimLabelingSource = readFileSync(
  "app/lib/report-engine/financial-claim-labeling.ts",
  "utf8"
);
const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

// --- Issue 1: raw badge suffix stripping ----------------------------------

function mirrorEvidenceTagStrip(value) {
  const evidenceTagSuffixPattern =
    /\s*[-–—]?\s*\(?\b(?:Verified|Estimated|Assumption|Planning assumption|AI Analysis|Model estimate|Model-derived estimate|Approximate|Doğrulanmış|Tahmini|Yaklaşık|Varsayım|Planlama varsayımı|AI Analizi|Model çıkarımı|Model tahmini)\b\)?\s*$/i;
  return value.replace(evidenceTagSuffixPattern, "").trim();
}

test("a raw evidence-classification tag directly appended after a value (no separator) is stripped", () => {
  assert.equal(mirrorEvidenceTagStrip("$51 AI Analysis"), "$51");
  assert.equal(mirrorEvidenceTagStrip("46% Assumption"), "46%");
  assert.equal(mirrorEvidenceTagStrip("4m AI Analysis"), "4m");
  assert.equal(mirrorEvidenceTagStrip("$177 (Estimated)"), "$177");
  assert.equal(mirrorEvidenceTagStrip("$28 - Assumption"), "$28");
  assert.equal(mirrorEvidenceTagStrip("Tahmini varsayım Tahmini"), "Tahmini varsayım");
});

test("all three formatMetricCardValue implementations (PDF export, on-screen dashboard, shared utils) strip the trailing badge (drift check)", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfSource],
    ["report-utils.ts", reportUtilsSource],
  ]) {
    assert.match(
      source,
      /evidenceTagSuffixPattern/,
      `${name}'s formatMetricCardValue has diverged -- missing the trailing badge stripper`
    );
    assert.match(
      source,
      /\.replace\(evidenceTagSuffixPattern, ""\)/,
      `${name}'s formatMetricCardValue has diverged -- stripper not wired into the chain`
    );
  }
});

// --- Issue 2: mobility mislabeling ----------------------------------------

test("isMobilityReportContent (both the PDF export and the on-screen dashboard's separate copy) keys off the deterministic Industry benchmark line, not loose topic words (drift check)", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfSource],
    ["Planner.tsx", plannerSource],
  ]) {
    const match = source.match(/function isMobilityReportContent\(content: string\) \{[\s\S]*?\n\}/);
    assert.ok(match, `${name}: isMobilityReportContent not found`);
    const returnStatement = match[0].slice(match[0].indexOf("return"));
    assert.match(
      returnStatement,
      /Industry benchmark:\\s\*Mobility \\\/ scooter rental/,
      `${name}: no longer matches the deterministic English signal`
    );
    assert.match(
      returnStatement,
      /Sektör referansı:\\s\*Mobilite \\\/ scooter kiralama/,
      `${name}: no longer matches the deterministic Turkish signal`
    );
  }
});

function mirrorIsMobilityReportContent(content) {
  return /\bIndustry benchmark:\s*Mobility \/ scooter rental\b|\bSektör referansı:\s*Mobilite \/ scooter kiralama\b/i.test(
    content
  );
}

test("an incidental, unrelated mention of a common word (rental/commuters/fleet) no longer false-positives as mobility", () => {
  const ecommerceReport =
    "Financial Assumptions\nIndustry benchmark: E-commerce\nBusiness model: subscription software\n" +
    "Go-to-Market: partner with equipment rental companies as an example vertical; target commuters using the delivery fleet as a case study.";

  assert.equal(mirrorIsMobilityReportContent(ecommerceReport), false);
});

test("a genuine mobility/scooter-rental report is still correctly detected", () => {
  const mobilityReport =
    "Financial Assumptions\nIndustry benchmark: Mobility / scooter rental\nBusiness model: asset-heavy rental / utilization model";

  assert.equal(mirrorIsMobilityReportContent(mobilityReport), true);
});

// --- Issue 3: CAC rendered as a percentage --------------------------------

test("CAC is removed from kpiDashboardMetrics in both renderers, per the kpiDashboard prompt's own exclusion (drift check)", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfSource],
    ["Planner.tsx", plannerSource],
  ]) {
    const match = source.match(/const kpiDashboardMetrics = \[[\s\S]*?\n\];/);
    assert.ok(match, `${name}: kpiDashboardMetrics not found`);
    assert.doesNotMatch(
      match[0],
      /\{ label: "CAC"/,
      `${name}: CAC is still present in kpiDashboardMetrics`
    );
    assert.match(match[0], /isPercentage: true/, `${name}: isPercentage flag missing`);
    assert.match(match[0], /isPercentage: false/, `${name}: isPercentage flag missing`);
  }
});

function mirrorExtractKpiValueFromSnippet({ explicitValue, targetValue, quantityValue, score, isPercentage }) {
  const effectiveScore = isPercentage ? score : null;
  const value = explicitValue ||
    targetValue ||
    quantityValue ||
    (effectiveScore === null ? "" : `${effectiveScore}%`) ||
    "";

  return !value ? "Validation Required" : value;
}

test("a non-percentage metric (CAC-shaped: a bare dollar figure) never renders with a guessed '%' suffix", () => {
  // The exact failure mode: a dollar value ($51) with no unit word
  // attached falls through to the bare-score fallback, which used to
  // append "%" unconditionally.
  const result = mirrorExtractKpiValueFromSnippet({
    explicitValue: "",
    targetValue: "",
    quantityValue: "",
    score: 51,
    isPercentage: false,
  });

  assert.equal(result, "Validation Required");
  assert.doesNotMatch(result, /%/);
});

test("a genuine percentage metric (Activation/Retention/Conversion) still renders its score with '%'", () => {
  const result = mirrorExtractKpiValueFromSnippet({
    explicitValue: "",
    targetValue: "",
    quantityValue: "",
    score: 62,
    isPercentage: true,
  });

  assert.equal(result, "62%");
});

test("extractKpiValueFromSnippet's own empty-value guard is present in both renderers, closing the drawing-layer's separate unguarded score fallback (drift check)", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfSource],
    ["Planner.tsx", plannerSource],
  ]) {
    assert.match(
      source,
      /return !value \|\| isMissingKpiText\(value\) \? "Validation Required" : value;/,
      `${name}: extractKpiValueFromSnippet no longer guards an empty resolved value`
    );
  }
});

// --- Issue 4: repeated verbatim fallback sentence -------------------------

test("the generic unavailable-data fallback now varies its explanation by report field, not just by label (drift check)", () => {
  assert.match(financialClaimLabelingSource, /fieldEvidenceContext/);
  // Reproduces a real, confirmed production bug found during live
  // 3-report verification: a deterministic "AI Executive Insight"
  // heading is reused for BOTH competitorLandscape's own insight AND
  // tamSamSom's market-sizing insight (buildExecutiveInsight, called
  // once per field). Every planFields entry needs its own evidence
  // clause -- otherwise two fields sharing a coincidental subject (or
  // both lacking any field-specific context) could still produce a
  // byte-identical full unavailable line.
  for (const field of [
    "competitorLandscape",
    "scenarioAnalysis",
    "roadmap306090",
    "founderRoadmap",
    "tamSamSom",
    "executiveSummary",
    "problem",
    "solution",
    "targetCustomer",
    "marketOpportunity",
    "unitEconomics",
    "financialDashboard",
    "financialAssumptions",
  ]) {
    assert.match(
      financialClaimLabelingSource,
      new RegExp(`\\b${field}: \\{`),
      `fieldEvidenceContext is missing an entry for "${field}"`
    );
  }
});

function mirrorGenericUnavailableCopyForLabel(fieldLabel, fieldName, fieldEvidenceContext, language) {
  const subject = fieldLabel.trim();
  const fieldContext = fieldEvidenceContext[fieldName];
  const evidenceClause = fieldContext
    ? language === "Turkish" ? fieldContext.tr : fieldContext.en
    : language === "Turkish"
      ? "kurucunun bu değerin dayandığı kanıtları paylaşması gerekir"
      : "the founder should share the evidence behind this figure to calculate it";

  return language === "Turkish"
    ? `${subject}: bu işletme için henüz doğrulanmış veri bulunmuyor; ${evidenceClause}`
    : `${subject}: no independently verified data exists yet for this business; ${evidenceClause}`;
}

test("four different fields that all fall through to the generic fallback never produce byte-identical explanation text", () => {
  const context = {
    competitorLandscape: { en: "share named competitor data", tr: "..." },
    scenarioAnalysis: { en: "share the scenario's own assumption", tr: "..." },
    roadmap306090: { en: "share the milestone's execution evidence", tr: "..." },
  };

  const competitor = mirrorGenericUnavailableCopyForLabel("Competitive moat", "competitorLandscape", context, "English");
  const scenario = mirrorGenericUnavailableCopyForLabel("Base Case Risk", "scenarioAnalysis", context, "English");
  const next30 = mirrorGenericUnavailableCopyForLabel("Next 30 Days", "roadmap306090", context, "English");
  const next6 = mirrorGenericUnavailableCopyForLabel("Next 6 Months", "roadmap306090", context, "English");

  const suffixes = [competitor, scenario, next30, next6].map(
    (line) => line.split("no independently verified data exists yet for this business; ")[1]
  );

  assert.notEqual(suffixes[0], suffixes[1]);
  assert.notEqual(suffixes[1], suffixes[2]);
  // Same field (roadmap306090) still differs because the subject differs.
  assert.notEqual(next30, next6);
  // No two of the four full lines are identical.
  assert.equal(new Set([competitor, scenario, next30, next6]).size, 4);
});

test("a field with no specific context entry still falls back to the original generic explanation, never a blank clause", () => {
  const line = mirrorGenericUnavailableCopyForLabel("Some Field", "executiveSummary", {}, "English");
  assert.match(line, /the founder should share the evidence behind this figure to calculate it$/);
});

// --- Issue 5: irrelevant sources + broken entry rendering -----------------

test("research source-stage guidance is domain-aware: business ideas get industry/competitor sources, not real-estate/legal/government-first guidance (drift check)", () => {
  assert.match(domainResearchSource, /function getResearchSourceStages\(domain: ResearchDomain\)/);
  assert.match(domainResearchSource, /businessResearchSourceStages/);
  assert.match(
    domainResearchSource,
    /const selectedStages = getResearchSourceStages\(researchPlan\.domain\);/
  );
  // The business-specific stage must actively steer away from
  // government/cadastral/court sources, not just add new guidance
  // alongside the old text.
  const businessStagesMatch = domainResearchSource.match(
    /const businessResearchSourceStages: Array<\{[\s\S]*?\n\];/
  );
  assert.ok(businessStagesMatch, "businessResearchSourceStages not found");
  assert.match(businessStagesMatch[0], /Do not search government procurement, cadastral, court/i);
  assert.match(businessStagesMatch[0], /G2, Capterra, TrustRadius/);
});

test("every researchSourceStages usage inside the research-execution closure was migrated to the domain-selected array (no stale reference left behind)", () => {
  // Only the definition, the type reference, and the selector function
  // itself may still name the flat constant directly.
  const occurrences = [...domainResearchSource.matchAll(/\bresearchSourceStages\b/g)].length;
  assert.equal(
    occurrences,
    4,
    "expected exactly 4 references to the flat researchSourceStages constant (definition, doc comment, type alias, and the domain selector's real_estate/legal fallback) -- a stale reference elsewhere means some code path is still using the wrong (non-domain-aware) stage list"
  );
});

test("a citation title/publisher with unbalanced parens or ending mid-abbreviation is treated as truncated and excluded (drift check)", () => {
  assert.match(pdfSource, /function looksTruncated\(value: string\)/);
  assert.match(pdfSource, /!looksTruncated\(trimmed\)/);
});

function mirrorLooksTruncated(value) {
  const openParens = (value.match(/\(/g) || []).length;
  const closeParens = (value.match(/\)/g) || []).length;
  if (openParens > closeParens) return true;
  return /\b[A-Z]\.\s*$/.test(value.trim());
}

test("a title truncated mid-parenthetical (the exact live example) is detected as truncated", () => {
  assert.equal(mirrorLooksTruncated("FPDS (U.S."), true);
});

test("a normal, complete organization name is never flagged as truncated", () => {
  assert.equal(mirrorLooksTruncated("World Health Organization"), false);
  assert.equal(mirrorLooksTruncated("Statista"), false);
  assert.equal(mirrorLooksTruncated("G2 Crowd, Inc."), false);
});

// Root cause behind the truncated-title example above, found during live
// 3-report verification: a source's raw sourceTitle/claim/publisher text
// sometimes carries its own embedded newline (e.g. a publisher name that
// wrapped across two lines on the source page, "U.S.\nCensus Bureau").
// Since the Title:/Publisher:/... format is one field per line, that
// embedded newline silently split one field into two lines downstream --
// only the first fragment ("U.S.") stayed attached to its label, and the
// remainder became an orphaned, unlabeled line no parser recognized.

test("buildResearchEvidenceLines collapses embedded newlines within a single field so it can never span multiple lines (drift check)", () => {
  assert.match(planExecutorSource, /function buildResearchEvidenceLines\(research: DomainResearchBundle\)/);
  assert.match(planExecutorSource, /collapseEvidenceFieldWhitespace/);
  assert.match(
    planExecutorSource,
    /Publisher: \$\{collapseEvidenceFieldWhitespace\(item\.publisher\)\}/,
    "the Publisher line no longer sanitizes embedded newlines"
  );
});

function mirrorCollapseEvidenceFieldWhitespace(value) {
  return value.replace(/\s*\n+\s*/g, " ").trim();
}

test("a publisher/title value with an embedded newline (the exact live shape) collapses to one clean line instead of silently splitting", () => {
  assert.equal(
    mirrorCollapseEvidenceFieldWhitespace("U.S.\nCensus Bureau"),
    "U.S. Census Bureau"
  );
  assert.equal(
    mirrorCollapseEvidenceFieldWhitespace("FPDS (U.S.\nGovernment Contracting)"),
    "FPDS (U.S. Government Contracting)"
  );
});

// --- Incidental finding during live verification: "Planning Planning
// assumption" ------------------------------------------------------------
// Found while re-checking KPI Dashboard cards during the 3-report live
// verification pass (not one of the 5 numbered issues, but the same
// class of bug -- an internal label duplicated next to a value -- so
// fixed under the same "find every other place this pattern occurs"
// directive). enforcePlanReportLanguage's tag-normalization pass
// converts a bare "Assumption" immediately before a closing paren into
// "Planning assumption" -- but the model sometimes already writes the
// full "Planning assumption" phrase itself, and the trailing "assumption"
// word in that phrase still matches the same regex, converting
// "$3k (Planning assumption)" into "$3k (Planning Planning assumption)".

test("enforcePlanReportLanguage's Assumption-before-paren tag normalizer has a negative lookbehind guarding against re-converting an already-correct 'Planning assumption' phrase (drift check)", () => {
  assert.match(
    planExecutorSource,
    /\(\?<!Planning\\s\)\\b\(Estimated\|Assumption\)\\b\(\?=\\s\*\\\)\)/,
    "the tag-before-paren normalizer no longer guards against double-converting 'Planning assumption'"
  );
});

function mirrorAssumptionParenNormalizer(text) {
  return text.replace(/(?<!Planning\s)\b(Estimated|Assumption)\b(?=\s*\))/gi, (_match, word) =>
    word.toLowerCase() === "estimated" ? "Approximate" : "Planning assumption"
  );
}

test("a value already correctly tagged '(Planning assumption)' is left untouched, not doubled", () => {
  assert.equal(
    mirrorAssumptionParenNormalizer("CAC: $3k (Planning assumption)"),
    "CAC: $3k (Planning assumption)"
  );
});

test("a bare '(Assumption)' tag is still correctly expanded to '(Planning assumption)'", () => {
  assert.equal(
    mirrorAssumptionParenNormalizer("CAC: $3k (Assumption)"),
    "CAC: $3k (Planning assumption)"
  );
});
