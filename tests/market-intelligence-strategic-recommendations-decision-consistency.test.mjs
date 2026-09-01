import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveMarketIntelligenceExecutiveDecision } from "../app/lib/report-engine/executive-decision-vocabulary.ts";
import { SENTENCE_ABBREVIATIONS } from "../app/lib/report-presentation.ts";

// TASK #17 -- Enforce one canonical decision across the entire Market
// Intelligence report.
//
// A REAL regenerated report showed:
//   Executive Summary decision: MONITOR (post Task #16 fix)
//   Confidence: Validation Required
//   SOM: Validation Required / not established
//   Strategic Recommendations: "Recommendation: Enter (evidence supports
//     entering with a validated mid-market penetration plan and
//     procurement readiness; see R12, R4, R5, R3)."
//
// ROOT CAUSE: strategicRecommendations' own prompt (market.ts) asks the
// model to "state plainly whether the evidence supports entering,
// piloting, or avoiding this market" as the OPENING sentence of its own
// field -- generated independently of, and never reconciled with,
// executiveSummary's own decision statement. The web/PDF item-extraction
// helper (extractRecommendationItems/isRecommendationHeadingLine, in
// page.tsx, Planner.tsx, and ReportPdfButton.tsx) only rejected a line as
// a non-item "heading" when the colon sat at the very END of the line
// (":$"). "Recommendation: Enter (evidence supports...)." has its colon
// in the MIDDLE, so it passed straight through and was rendered verbatim
// as a fake numbered "Action" card -- literally displaying "Recommendation:
// Enter" next to Executive Summary's own MONITOR decision.
//
// FIX (two parts, mirrored across page.tsx, Planner.tsx, and
// ReportPdfButton.tsx):
//   1. isRecommendationHeadingLine now also rejects lines opening with
//      "Recommendation:"/"Conviction:"/"Trade-offs:" -- these are
//      Executive-Summary-owned verdict/reasoning language, never action
//      items, regardless of which decision they happen to state.
//   2. Strategic Recommendations now explicitly displays a "Current
//      Decision: X" line/badge, reading the SAME canonical resolver
//      (resolveMarketIntelligenceExecutiveDecision) against the SAME
//      executiveSummary content every other decision surface already
//      reads -- so this section can never assert a decision Executive
//      Summary itself disagrees with, regardless of what its own raw
//      text says.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
// TASK #29J -- isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/
// isEvidenceStatusDisclaimerLine/extractRecommendationItems were
// consolidated into this single shared module.
const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;

  let i = start + startMatch[0].length - 1;
  let parenDepth = 1;
  while (parenDepth > 0) {
    i += 1;
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") parenDepth -= 1;
  }
  while (source[i] !== "{") {
    i += 1;
  }

  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);

  return source.slice(start, i);
}

async function compileExtractRecommendationItems(source) {
  // TASK #29J -- these functions now live solely in report-presentation.ts;
  // `source` (the calling surface's own file) is accepted for the
  // caller's own labeling/looping but no longer used for extraction.
  void source;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-strategic-rec-"));
  const outPath = join(dir, "extract.mts");
  const harness = `
const SENTENCE_ABBREVIATIONS = ${JSON.stringify(SENTENCE_ABBREVIATIONS)};

${extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine")}

${extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine")}

${extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine")}

${extractFunctionSource(reportPresentationSource, "extractRecommendationItems")}

export { extractRecommendationItems };
`;
  writeFileSync(outPath, harness);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractRecommendationItems;
}

const surfaces = [
  { label: "page.tsx", source: pageSource },
  { label: "ReportPdfButton.tsx", source: pdfButtonSource },
  { label: "Planner.tsx", source: plannerSource },
];

// A generic (not the real report's own wording) reproduction of the
// exact reported shape: a "Recommendation:"/"Conviction:"/"Trade-offs:"
// preamble followed by real numbered actions on their own lines.
const genericStrategicRecommendationsContent =
  "Recommendation: Enter (evidence supports entering the target segment with a validated go-to-market plan).\n" +
  "Conviction: Supported by growth forecasts and active vendor productization.\n" +
  "Trade-offs: Invest early in accuracy benchmarking rather than broad feature parity.\n" +
  "1) Run a 90-day pilot with three design partners to validate willingness to pay.\n" +
  "2) Commission a $40,000 independent accuracy benchmark against two incumbents.\n" +
  "If both succeed, scale; otherwise re-evaluate and monitor instead.";

test("ROOT CAUSE FIX: 'Recommendation:'/'Conviction:'/'Trade-offs:' preamble lines are excluded from the numbered action items, in all three surfaces", async () => {
  for (const { label, source } of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(genericStrategicRecommendationsContent);

    for (const item of items) {
      assert.doesNotMatch(
        item,
        /^(?:recommendation|conviction|trade-?offs?)\s*:/i,
        `${label}: a verdict/reasoning preamble line must never be rendered as an action item, got ${JSON.stringify(item)}`
      );
    }
    assert.ok(items.length > 0, `${label}: real action items must still be extracted`);
    assert.ok(
      items.some((item) => item.includes("90-day pilot")),
      `${label}: expected the real numbered actions to survive, got ${JSON.stringify(items)}`
    );
  }
});

test("no regression: ordinary action lines with a colon inside them (not a verdict-preamble label) are still accepted, in all three surfaces", async () => {
  const content =
    "1) Validate demand: run 3 customer discovery interviews per week for 60 days.\n" +
    "2) Confirm pricing: test two price points with 10 prospective buyers each.";

  for (const { label, source } of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 2, `${label}: expected both real action lines to survive, got ${JSON.stringify(items)}`);
  }
});

test("no regression: the pre-existing deterministic heading rejections ('First 90 Days', 'Market Entry Recommendation') are untouched, in all three surfaces", async () => {
  const content =
    "First 90 Days (three actions with owners, budgets, KPIs, and success criteria):\n" +
    "1) A concrete, measurable action with a real owner and budget.\n" +
    "Market Entry Recommendation:\n" +
    "2) Another concrete, measurable action.";

  for (const { source } of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    for (const item of items) {
      assert.doesNotMatch(item, /^first\s+90\s*-?\s*days?/i);
      assert.doesNotMatch(item, /^market entry recommendation/i);
    }
  }
});

test("CANONICAL DECISION SCENARIO: MONITOR + validation-required SOM -- Strategic Recommendations' displayed decision badge resolves to MONITOR, matching Executive Summary, never ENTER", () => {
  const monitorExecutiveSummary =
    "Bottom Line — Decision: ENTER the U.S. market for 2027.\n" +
    "Biggest Risk — Key unresolved: realistic obtainable market share (SOM) is not evidenced; go/no-go depends on validated penetration/win-rate evidence.";

  const decision = resolveMarketIntelligenceExecutiveDecision(monitorExecutiveSummary, "English");
  // Task #16's own fix: an unverified strong-affirmative raw decision is
  // downgraded to MONITOR -- this is the canonical value Strategic
  // Recommendations' new badge must read and display, never re-deriving
  // its own separate verdict.
  assert.equal(decision.decisionLabel, "MONITOR");

  // TASK #24 -- Strategic Recommendations' decision badge now resolves
  // through resolveMarketIntelligenceExecutiveDecisionWithCanonicalState
  // (prefers a persisted canonical decision, falls back to this exact
  // same resolveMarketIntelligenceExecutiveDecision behavior for every
  // report without one) -- still against the same executiveSummary
  // content, still never re-deriving its own separate verdict.
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    // TASK #31 -- ReportPdfButton.tsx now reads canonical state once into
    // `recommendationCanonicalState` (reused by the new per-card
    // classification too) instead of a fresh inline
    // readMarketIntelligenceCanonicalState(report.metadata) call at this
    // exact site -- same underlying data, read once instead of twice.
    assert.match(
      source,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n?\s*(?:marketIntelligenceCanonicalState|readMarketIntelligenceCanonicalState\(report\.metadata\)|recommendationCanonicalState),\s*\n?\s*(?:executiveSummaryContent|pdfSections\.find\(\(entry\) => entry\.field === "executiveSummary"\)\?\.content \|\| "")/,
      "Strategic Recommendations must resolve its decision through the same canonical resolver, against the same executiveSummary content"
    );
  }
});

test("CANONICAL DECISION SCENARIO: ENTER -- when Executive Summary genuinely resolves to a verified ENTER, Strategic Recommendations' badge reflects the same ENTER, not a downgraded or independent value", () => {
  const enterExecutiveSummary = "Decision: ENTER (Confidence: 82%)\nStrong evidence across all decision-critical pillars supports this call.";
  const decision = resolveMarketIntelligenceExecutiveDecision(enterExecutiveSummary, "English");
  assert.equal(decision.decisionLabel, "ENTER");
  assert.equal(decision.canonicalDecision, "PROCEED");
});

test("CANONICAL DECISION SCENARIO: DO NOT ENTER / AVOID -- Strategic Recommendations' badge reflects the same AVOID decision, never an upgraded or independent value", () => {
  const avoidExecutiveSummary = "Decision: AVOID (Confidence: 74%)\nUnit economics do not support entry at this time.";
  const decision = resolveMarketIntelligenceExecutiveDecision(avoidExecutiveSummary, "English");
  assert.equal(decision.decisionLabel, "AVOID");
  assert.equal(decision.canonicalDecision, "REJECT");
});

test("WEB PRESENTATION: page.tsx and Planner.tsx thread executiveSummaryContent into their Strategic-Recommendations-rendering component and display a 'Current Decision' badge derived from it, gated to Market Intelligence only", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /executiveSummaryContent(?:\s*=\s*""|\?:\s*string)/, "expected an executiveSummaryContent prop");
    assert.match(source, /Current Decision:\s*\{strategicRecommendationDecision\.decisionLabel\}/);
    assert.match(
      source,
      /const strategicRecommendationDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/,
      "the badge must be gated behind isMarketIntelligence, never computed for other report kinds"
    );
  }
});

test("PDF PRESENTATION: ReportPdfButton.tsx and Planner.tsx's PDF drawer both draw the same 'Current Decision' text above the recommendation cards, reserving height for it via one shared constant", () => {
  // TASK #25C -- the height-budgeting and drawing passes for this badge
  // were merged into ONE dedicated pagination-aware branch (see that
  // branch's own comment), so strategicRecommendationDecisionBadgeHeight
  // is now read from exactly one call site instead of two independent
  // ones -- still structurally impossible to drift, since there is only
  // one place left that could.
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /const strategicRecommendationDecisionBadgeHeight = 7;/);
    assert.match(source, /localizePdfPresentationLabel\("Current Decision", pdfLocale\)/);
    const occurrences = source.match(/strategicRecommendationDecisionBadgeHeight/g) || [];
    assert.ok(
      occurrences.length >= 2,
      `expected the badge-height constant to be declared once and used at least once, got ${occurrences.length} occurrences`
    );
  }
});

test("requirement 9 (preserve evidence-first behavior): the badge never fabricates a decision -- when executiveSummaryContent has no resolvable decision at all, no badge is drawn/rendered", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /strategicRecommendationDecision && strategicRecommendationDecision\.decisionLabel !== "—" \? \(/,
      "the web badge must be omitted entirely when the canonical decision is genuinely unavailable"
    );
  }
  // TASK #25C -- the PDF badge text is now computed once as a ternary
  // (decisionBadgeText), then only drawn `if (isFirstChunk &&
  // decisionBadgeText)` -- an empty string is falsy, so the badge is still
  // completely omitted (not drawn as an empty line) whenever
  // decisionLabel is genuinely "—". Same guarantee, different shape.
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(
      source,
      /strategicRecommendationDecision\.decisionLabel !== "—"\s*\n\s*\? `\$\{localizePdfPresentationLabel\("Current Decision", pdfLocale\)\}: \$\{strategicRecommendationDecision\.decisionLabel\}`\s*\n\s*: "";/,
      "the PDF badge text must resolve to an empty string (never drawn) when the canonical decision is genuinely unavailable"
    );
    assert.match(
      source,
      /if \(isFirstChunk && decisionBadgeText\) \{/,
      "the PDF badge must only be drawn when a real decision badge text was computed"
    );
  }
});
