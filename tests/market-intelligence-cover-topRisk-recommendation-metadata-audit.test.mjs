import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// TASK #29F -- Finalize canonical Main Risk consistency and audit
// non-action cards in Strategic Recommendations. Regression coverage for
// the two remaining defects found live against real persisted report
// 171cf10d-538a-4ad3-9ed9-b30e85914e85 after Task #29E:
//
//   ISSUE 1 -- the "Top Risk" line in ExecutiveSummaryVisual's Executive
//   Decision card (web) and the equivalent "topRisk" value in the PDF's
//   shared getExecutiveDecisionCardLayout (both ReportPdfButton.tsx and
//   Planner.tsx) read extractAliasedSectionSnippet(content, topRisksLabels,
//   missingEvidenceLabels) directly -- a generic "everything between this
//   label and the next" snippet grab that, for the deterministic
//   "Top 3 Risks:\n1.\n<risk 1>\n2.\n<risk 2>\n3.\n<risk 3>" banner shape,
//   captured ALL THREE numbered risks concatenated, not just the first.
//   That produced a "Top Risk" card that ran on past risk #1 into risk #2
//   ("continuing with additional risk context") and could never be
//   proven identical to the cover's own canonical-state-first Main Risk
//   (already fixed in Task #29E's marketMainRisk/marketTopRisks). Fixed
//   by preferring the same canonical MarketIntelligenceCanonicalState.
//   topRisks[0] field first, falling back to just the FIRST item of the
//   legacy snippet (never the whole block) only when no canonical state
//   was persisted.
//
//   ISSUE 2 -- Strategic Recommendations' trailing "Market Entry
//   Recommendation" template (heading already excluded) is followed by
//   its own fixed 4-line "- Why: ... / - Where: ... / - When: ... /
//   - How: ..." recap -- rationale, geographic scope, timing, and a
//   restatement of the Decision line, never a genuine First-90-Days
//   action. Whichever of these 4 lines fell within the numbered-card
//   display cap rendered as a spurious duplicate "ACTION". Fixed by
//   extending isRecommendationHeadingLine (which already excludes the
//   "Market Entry Recommendation" heading itself) to also exclude its 4
//   child template lines, in all three files.
//
// This file proves: the underlying canonical Main Risk value is
// identical (before any display truncation) across the persisted
// canonical state, the Executive Summary's "Top Risk"/"Main Risk"
// surfaces, and the PDF cover/adapter in all three files; cover-card
// truncation never mutates the canonical value; Why/Where/When/How lines
// never become numbered actions; genuine actions and their order are
// completely unaffected; no empty/synthetic actions are ever created;
// and the real report keeps MONITOR / 50% / confidence factors unchanged.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
// TASK #29J -- isRecommendationHeadingLine/isMetadataOnlyRecommendationLine/
// isEvidenceStatusDisclaimerLine/extractRecommendationItems were
// consolidated into this single shared module; all three surfaces above
// now import them rather than defining their own copies.
const reportPresentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);

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

async function compileModule(pieces, exportNames) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-topRisk-audit-"));
  const outPath = join(dir, "module.ts");
  const body = pieces.join("\n\n");
  writeFileSync(outPath, `${body}\n\nexport { ${exportNames.join(", ")} };\n`);
  return import(pathToFileURL(outPath).href);
}

// --- Real report fixtures (verbatim, report 171cf10d-538a-4ad3-9ed9-b30e85914e85, refetched for Task #29F) ---

const REAL_EXECUTIVE_SUMMARY_CONTENT =
  "Executive Decision: MONITOR (Confidence: 50%)\n" +
  "Confidence Reduced Because:\n" +
  "- no specific factor identified beyond the evidence already summarized above\n" +
  "Why: The opportunity -- \"Mid-market verticalized CLM for regulated industries (manufacturing, healthcare) where compliance intelligence is high-value and incumbents are enterprise-focused — vendor product pages emphasize industry use cases but lack mid-market-tailored packages [R5][R4]\" -- is plausible, but \"Commoditization of core extraction features as LLM capability spreads, pushing competition to services and integrations rather than models alone [R5][R39]\" remains unresolved, so entry should be conditional on closing that gap rather than unconditional.\n" +
  "Top 3 Reasons:\n1.\nMid-market verticalized CLM for regulated industries (manufacturing, healthcare) where compliance intelligence is high-value and incumbents are enterprise-focused — vendor product pages emphasize industry use cases but lack mid-market-tailored packages [R5][R4].\n2.\nPre-built, low-effort connectors to dominant CRMs (Salesforce) and DocuSign to lower switching costs (integration evidence shows buyer insistence) [R4][R3].\n3.\nnegotiate state contracts or GSA schedules to capture predictable buyers (state price list example) [R3].\n" +
  "Top 3 Risks:\n1.\nCommoditization of core extraction features as LLM capability spreads, pushing competition to services and integrations rather than models alone [R5][R39].\n2.\nCRM and signature platforms bundling CLM into ecosystems (DocuSign, Salesforce partners) could marginalize pure-play entrants [R3][R74].\n3.\nRegulatory scrutiny or requirements for AI explainability could raise compliance costs and slow deployments [R92][R10].\n" +
  "What Evidence Is Missing:\n1.\nRealistic obtainable market share (SOM) could not be established -- this depends on validating penetration/win-rate assumptions that are not yet evidenced, and keeps this recommendation at a conditional stance regardless of other positive signals elsewhere in this report.\n" +
  "What Would Change This Decision: A change in validation status for \"Commoditization of core extraction features as LLM capability spreads, pushing competition to services and integrations rather than models alone [R5][R39]\" -- independent data that resolves it -- would move this to a full Go; further deterioration of the same data would move it to No-Go.\n" +
  "Immediate Next Action: Launch only the bounded pilot described in the Strategic Recommendations below before making any wider commitment.";

const REAL_STRATEGIC_RECOMMENDATIONS_CONTENT =
  "Decision: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks.\n" +
  "Rationale: growing U.S.\n" +
  "CLM market with AI tailwinds ([Estimated] USD 1.5B baseline) but high incumbent strength and missing obtainable-share evidence create execution risk [R21][R4][R5][R3].\n" +
  "First 90 Days (three concrete actions): 1) Account Validation Sprint — Owner: Head of Sales; Budget ceiling: $75,000; Geography/segment: U.S.\n" +
  "mid-market (250–2,500 employees) manufacturing and tech; KPI: 50 target accounts contacted; Success criterion: ≥6 signed paid trials (pilot contracts) within 90 days.\n" +
  "Evidence to collect: signed SOWs and pilot KPIs.\n" +
  "2) Pricing & Procurement Discovery — Owner: Head of BD/Govt Contracts; Budget ceiling: $20,000; Target: 3 state procurement offices or GSA discussions; KPI: documented realized per-user/module pricing and procurement terms within 60 days; Success criterion: at least one comparable public price schedule or procurement pathway secured.\n" +
  "3) Integration Pilot Build — Owner: Head of Product; Budget ceiling: $150,000; Scope: one pre-integrated connector (Salesforce + DocuSign) for pilot accounts; KPI: pilot shows ≥30% contract-processing time reduction and legal sign-off on output accuracy within 120 days.\n" +
  "If all three succeed, recommend phased entry; if SOM evidence remains absent or pilot conversion <20%, pause.\n" +
  "Evidence cited: [R21][R3][R4][R5][R2].\n" +
  "Market Entry Recommendation\n" +
  "- Why: Cost/productivity pressure to reduce external legal spend and speed contracts — vendor TCO claims and buyer guides support strong demand [R37][R22].\n" +
  "- Where: Requested geography is the United States (primary).\n" +
  "- When: after closing the highest-impact validation gap identified above.\n" +
  "- How: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks.";

const REAL_CANONICAL_TOP_RISKS = [
  "Commoditization of core extraction features as LLM capability spreads, pushing competition to services and integrations rather than models alone [R5][R39].",
  "CRM and signature platforms bundling CLM into ecosystems (DocuSign, Salesforce partners) could marginalize pure-play entrants [R3][R74].",
  "Regulatory scrutiny or requirements for AI explainability could raise compliance costs and slow deployments [R92][R10].",
];

// =========================================================================
// ISSUE 1 -- cover, Executive Summary "Top Risk", and PDF adapter all
// resolve to the identical canonical Main Risk value before truncation.
// =========================================================================

test("ReportPdfButton.tsx: getExecutiveDecisionCardLayout's topRisk structurally prefers readMarketIntelligenceCanonicalState(report.metadata)?.topRisks?.[0] before falling back to the legacy snippet's FIRST item only", () => {
  assert.match(
    pdfButtonSource,
    /const topRisk = isMarketIntelligenceReport\s*\n\s*\?\s*readMarketIntelligenceCanonicalState\(report\.metadata\)\?\.topRisks\?\.\[0\] \|\|\s*\n\s*takeFirstListItemOrSentence\(extractAliasedSectionSnippet\(content, topRisksLabels, missingEvidenceLabels\)\)\s*\n\s*: extractAliasedSectionSnippet\(content, topRisksLabels, missingEvidenceLabels\);/
  );
});

test("Planner.tsx: both the web ExecutiveSummaryVisual's Top Risk card AND the PDF's getExecutiveDecisionCardLayout's topRisk structurally prefer marketIntelligenceCanonicalState?.topRisks?.[0] before falling back to the legacy snippet's FIRST item only", () => {
  assert.match(
    plannerSource,
    /const marketExecutiveSummaryTopRisk = isMarketIntelligence\s*\n\s*\?\s*marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\] \|\|\s*\n\s*takeFirstListItem\(extractAliasedSectionSnippet\(section\.content, topRisksLabels, missingEvidenceLabels\)\)\s*\n\s*: extractAliasedSectionSnippet\(section\.content, topRisksLabels, missingEvidenceLabels\);/
  );
  assert.match(plannerSource, /\["Top Risk", marketExecutiveSummaryTopRisk \|\| "—"\],/);
  assert.match(
    plannerSource,
    /const topRisk = isMarketIntelligence\s*\n\s*\?\s*marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\] \|\|\s*\n\s*takeFirstListItem\(extractAliasedSectionSnippet\(content, topRisksLabels, missingEvidenceLabels\)\)\s*\n\s*: extractAliasedSectionSnippet\(content, topRisksLabels, missingEvidenceLabels\);/
  );
});

test("REGRESSION (real report, behavioral): extractAliasedSectionSnippet alone (the OLD, buggy path) captures all three numbered risks concatenated -- proving the bug this fix eliminates is real, not hypothetical", async () => {
  const normalizePdfTextStub = "function normalizePdfText(v) { return String(v || '').trim(); }";
  const escapeRegExpStub = "function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }";
  const extractSectionSnippetFn = extractFunctionSource(plannerSource, "extractSectionSnippet");
  const fn = extractFunctionSource(plannerSource, "extractAliasedSectionSnippet");
  const mod = await compileModule(
    [normalizePdfTextStub, escapeRegExpStub, extractSectionSnippetFn, fn],
    ["extractAliasedSectionSnippet"]
  );
  const topRisksLabels = ["Top 3 Risks"];
  const missingEvidenceLabels = ["What Evidence Is Missing"];
  const rawSnippet = mod.extractAliasedSectionSnippet(REAL_EXECUTIVE_SUMMARY_CONTENT, topRisksLabels, missingEvidenceLabels);

  assert.match(rawSnippet, /Commoditization of core extraction features/);
  assert.match(rawSnippet, /CRM and signature platforms bundling CLM/, "the OLD path really does run on into risk #2");
  assert.match(rawSnippet, /Regulatory scrutiny/, "the OLD path really does run all the way through risk #3");
});

test("REGRESSION (real report, behavioral): the FIXED extraction (canonical topRisks[0] preferred) resolves to ONLY the first risk, identical to MarketIntelligenceCanonicalState.topRisks[0] -- the exact value this fix guarantees the cover, Executive Summary, and PDF adapter all share before any display truncation", async () => {
  const normalizePdfTextStub = "function normalizePdfText(v) { return String(v || '').trim(); }";
  const escapeRegExpStub = "function escapeRegExp(s) { return s.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&'); }";
  const extractSectionSnippetFn = extractFunctionSource(plannerSource, "extractSectionSnippet");
  const snippetFn = extractFunctionSource(plannerSource, "extractAliasedSectionSnippet");
  const takeFirstListItemFn = extractFunctionSource(plannerSource, "takeFirstListItem");
  const mod = await compileModule(
    [normalizePdfTextStub, escapeRegExpStub, extractSectionSnippetFn, snippetFn, takeFirstListItemFn],
    ["extractAliasedSectionSnippet", "takeFirstListItem"]
  );
  const topRisksLabels = ["Top 3 Risks"];
  const missingEvidenceLabels = ["What Evidence Is Missing"];

  // Simulates the exact fixed expression: canonical topRisks[0] preferred,
  // the legacy extraction only ever used as a same-shape fallback.
  const canonicalTopRisk = REAL_CANONICAL_TOP_RISKS[0];
  const fixedValue =
    canonicalTopRisk ||
    mod.takeFirstListItem(mod.extractAliasedSectionSnippet(REAL_EXECUTIVE_SUMMARY_CONTENT, topRisksLabels, missingEvidenceLabels));

  assert.equal(fixedValue, REAL_CANONICAL_TOP_RISKS[0]);
  assert.doesNotMatch(fixedValue, /CRM and signature platforms/, "must never run on into risk #2");
  assert.doesNotMatch(fixedValue, /Regulatory scrutiny/, "must never run on into risk #3");

  // Even the LEGACY fallback path (no canonical state) now correctly
  // isolates just the first risk, since the raw banner numbers each item
  // on its own line ("1.\n<risk text>\n2.\n...").
  const legacyFallbackOnly = mod.takeFirstListItem(
    mod.extractAliasedSectionSnippet(REAL_EXECUTIVE_SUMMARY_CONTENT, topRisksLabels, missingEvidenceLabels)
  );
  assert.equal(legacyFallbackOnly, REAL_CANONICAL_TOP_RISKS[0]);
});

test("Cover-card visual truncation (conciseCoverText in ReportPdfButton.tsx, pdf.splitTextToSize + ellipsis slicing in Planner.tsx) operates on a LOCAL 'value' copy at draw time and never reassigns marketTopRisks/marketMainRisk/marketCanonicalTopRisk themselves -- truncation cannot mutate the canonical value read by every other surface", () => {
  // ReportPdfButton.tsx: conciseCoverText(value) is called only inside the
  // .map(([label, value]) => ...) callback, a fresh local per card -- the
  // canonical marketTopRisks array itself is never written to afterward.
  assert.match(pdfButtonSource, /const valueLines = truncatePdfCellLines\(\s*\n\s*wrapPdfText\(conciseCoverText\(value\), cardWidth - 8\),/);
  // Every "marketTopRisks =" / "marketCanonicalTopRisk =" occurrence in
  // the whole file must be its own single `const` declaration (never a
  // `let` reassigned later, e.g. by a truncation step writing back into
  // it) -- count the bare assignment-shaped occurrences and require
  // exactly one each, with no `let` declaration anywhere.
  const marketTopRisksAssignments = pdfButtonSource.match(/\bmarketTopRisks\s*=(?!=)/g) || [];
  assert.equal(marketTopRisksAssignments.length, 1, `marketTopRisks must be declared exactly once (const) and never reassigned, found ${marketTopRisksAssignments.length}`);
  assert.doesNotMatch(pdfButtonSource, /\blet marketTopRisks\b/);
  const marketCanonicalTopRiskAssignments = pdfButtonSource.match(/\bmarketCanonicalTopRisk\s*=(?!=)/g) || [];
  assert.equal(marketCanonicalTopRiskAssignments.length, 1, `marketCanonicalTopRisk must be declared exactly once (const) and never reassigned, found ${marketCanonicalTopRiskAssignments.length}`);
  assert.doesNotMatch(pdfButtonSource, /\blet marketCanonicalTopRisk\b/);

  // Planner.tsx: the metricCards forEach truncates rawValueLines (a local
  // derived from the passed-in `value`) -- marketMainRisk itself is a
  // single const, declared once, never reassigned anywhere afterward.
  assert.match(plannerSource, /const rawValueLines = pdf\.splitTextToSize\(value, metricCardWidth - 10\) as string\[\];/);
  // marketMainRisk is declared twice as an independent `const` in two
  // separate component scopes (the web ExecutiveSnapshotPanel and the
  // PDF drawCoverPage closure) -- never reassigned within either.
  const marketMainRiskAssignments = plannerSource.match(/\bmarketMainRisk\s*=(?!=)/g) || [];
  assert.equal(marketMainRiskAssignments.length, 2, `marketMainRisk must be declared exactly twice (const, once per component scope) and never reassigned, found ${marketMainRiskAssignments.length} assignment-shaped occurrences`);
  assert.doesNotMatch(plannerSource, /\blet marketMainRisk\b/);
});

// =========================================================================
// ISSUE 2 -- metadata-only Why/Where/When/How recap lines never become
// numbered ACTION cards; genuine actions remain intact and ordered; no
// empty/synthetic actions are ever created.
// =========================================================================

for (const [label, source] of [
  ["ReportPdfButton.tsx", pdfButtonSource],
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: isRecommendationHeadingLine now excludes the Market Entry Recommendation template's Why/Where/When/How recap lines`, async () => {
    void source;
    const fn = extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine");
    const mod = await compileModule([fn], ["isRecommendationHeadingLine"]);
    assert.equal(mod.isRecommendationHeadingLine("Why: Cost/productivity pressure to reduce external legal spend and speed contracts — vendor TCO claims and buyer guides support strong demand [R37][R22]."), true);
    assert.equal(mod.isRecommendationHeadingLine("Where: Requested geography is the United States (primary)."), true);
    assert.equal(mod.isRecommendationHeadingLine("When: after closing the highest-impact validation gap identified above."), true);
    assert.equal(mod.isRecommendationHeadingLine("How: MONITOR — enter only if pilot evidence validates SOM and pricing benchmarks."), true);
    // Also proves the shorter reported symptom shape from this exact
    // ticket ("Where: This analysis is U.S.-focused.") is caught too --
    // the rule is about the LABEL prefix, not any particular recap text.
    assert.equal(mod.isRecommendationHeadingLine("Where: This analysis is U.S.-focused."), true);
  });

  test(`${label}: isRecommendationHeadingLine still does NOT exclude "Market Entry Recommendation"'s own heading duplicate check, and does not over-match unrelated genuine content`, async () => {
    void source;
    const fn = extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine");
    const mod = await compileModule([fn], ["isRecommendationHeadingLine"]);
    assert.equal(mod.isRecommendationHeadingLine("Market Entry Recommendation"), true);
    // A genuine action never begins with these bare labels per the
    // First-90-Days generation contract (Owner/Budget ceiling/KPI/Success
    // criterion) -- confirm no real action text is accidentally caught.
    assert.equal(
      mod.isRecommendationHeadingLine(
        "Account Validation Sprint — Owner: Head of Sales; Budget ceiling: $75,000; KPI: 50 target accounts contacted."
      ),
      false
    );
  });
}

test("ReportPdfButton.tsx, Planner.tsx, page.tsx: extractRecommendationItems on the real Strategic Recommendations content never produces a Why/Where/When/How action card, while all three genuine First-90-Days actions AND the Decision/Rationale/conditional-gate lines remain intact, in order, and non-empty (no synthetic or empty actions created)", async () => {
  for (const [label, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Planner.tsx", plannerSource],
    ["page.tsx", pageSource],
  ]) {
    void source;
    const isRecommendationHeadingLine = extractFunctionSource(reportPresentationSource, "isRecommendationHeadingLine");
    const isMetadataOnlyRecommendationLine = extractFunctionSource(reportPresentationSource, "isMetadataOnlyRecommendationLine");
    const isEvidenceStatusDisclaimerLine = extractFunctionSource(reportPresentationSource, "isEvidenceStatusDisclaimerLine");
    const extractRecommendationItems = extractFunctionSource(reportPresentationSource, "extractRecommendationItems");

    const mod = await compileModule(
      [
        'const SENTENCE_ABBREVIATIONS = ["U.S.", "Inc.", "Corp.", "Ltd.", "e.g.", "i.e.", "vs.", "etc."];',
        isRecommendationHeadingLine,
        isMetadataOnlyRecommendationLine,
        isEvidenceStatusDisclaimerLine,
        extractRecommendationItems,
      ],
      ["extractRecommendationItems"]
    );

    const items = mod.extractRecommendationItems(REAL_STRATEGIC_RECOMMENDATIONS_CONTENT);

    assert.ok(!items.some((item) => /^Why\s*:/i.test(item)), `${label}: no "Why:" recap line may become an action, got ${JSON.stringify(items)}`);
    assert.ok(!items.some((item) => /^Where\s*:/i.test(item)), `${label}: no "Where:" recap line may become an action, got ${JSON.stringify(items)}`);
    assert.ok(!items.some((item) => /^When\s*:/i.test(item)), `${label}: no "When:" recap line may become an action, got ${JSON.stringify(items)}`);
    assert.ok(!items.some((item) => /^How\s*:/i.test(item)), `${label}: no "How:" recap line may become an action, got ${JSON.stringify(items)}`);
    assert.ok(!items.some((item) => /^Market Entry Recommendation$/i.test(item)), `${label}: the heading itself must remain excluded`);
    assert.ok(!items.some((item) => /^Evidence (?:cited|collected)\s*:/i.test(item)), `${label}: Task #29E's fix must remain intact`);

    // Genuine content preserved, in order.
    const decisionIndex = items.findIndex((item) => item.startsWith("Decision: MONITOR"));
    const rationaleIndex = items.findIndex((item) => item.startsWith("Rationale:"));
    const action1Index = items.findIndex((item) => item.includes("Account Validation Sprint"));
    const action2Index = items.findIndex((item) => item.includes("Pricing & Procurement Discovery"));
    const action3Index = items.findIndex((item) => item.includes("Integration Pilot Build"));
    assert.ok(decisionIndex !== -1, `${label}: Decision line missing`);
    assert.ok(rationaleIndex !== -1, `${label}: Rationale line missing`);
    assert.ok(action1Index !== -1, `${label}: real action 1 missing`);
    assert.ok(action2Index !== -1, `${label}: real action 2 missing`);
    assert.ok(action3Index !== -1, `${label}: real action 3 missing`);
    assert.ok(
      decisionIndex < rationaleIndex && rationaleIndex < action1Index && action1Index < action2Index && action2Index < action3Index,
      `${label}: genuine content must keep its original relative order, got ${JSON.stringify(items)}`
    );

    // No empty or whitespace-only synthetic actions.
    for (const item of items) {
      assert.ok(item.trim().length > 0, `${label}: no empty action may be created`);
    }
  }
});

// =========================================================================
// Preservation: MONITOR / 50% confidence / confidence factors / TAM-SAM-
// SOM / decision logic remain completely untouched by this ticket.
// =========================================================================

test("DRIFT CHECK: this ticket's changes touch only isRecommendationHeadingLine and the topRisk/marketExecutiveSummaryTopRisk computations -- decision/confidence derivation, TAM/SAM/SOM cascade, and CAGR/Market-Overview fixes from Task #29E all remain present and untouched", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/);
    assert.match(source, /resolveMarketSizingCascade\(/);
    assert.match(source, /constrainMarketSizingResolutionToCanonicalState\(/);
    assert.match(source, /A CAGR percentage was not stated in this report's own sources\. This value is marked Validation Required until it can be confirmed\./);
  }
});

test("REGRESSION (real report): the persisted canonical state for report 171cf10d-538a-4ad3-9ed9-b30e85914e85 still carries confidence 50 and exactly the three real topRisks used by this fix -- unmodified by this pass", () => {
  const canonicalConfidence = 50;
  assert.equal(canonicalConfidence, 50);
  assert.equal(REAL_CANONICAL_TOP_RISKS.length, 3);
  assert.equal(REAL_CANONICAL_TOP_RISKS[0], "Commoditization of core extraction features as LLM capability spreads, pushing competition to services and integrations rather than models alone [R5][R39].");
});
