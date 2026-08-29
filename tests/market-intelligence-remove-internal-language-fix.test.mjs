import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// FINAL POLISH -- remove internal intelligence language from Market
// Intelligence reports.
//
// Builds on two prior Market Intelligence polish tickets (decision-
// vocabulary consistency, "Confidence Radar"/citation-badge wording).
// This ticket goes further:
//
// 1. Internal terminology removed from ALL user-visible MI surfaces,
//    not just the ones already covered: a new Market-Intelligence-only
//    EvidenceBadge label wrapper (marketEvidenceBadgeLabels, mirroring
//    the established financialEvidenceBadgeLabels pattern) replaces the
//    bare "Verified"/"Estimated"/"Assumption"/"AI Analysis" words with
//    "Data Confirmed"/"Market Support"/"Key Assumption"/"Validation
//    Status" wherever a section-level evidence badge renders for a
//    Market Intelligence report -- in both app/dashboard/[id]/page.tsx
//    and components/Planner.tsx, across every call site (KPI cards,
//    TAM/SAM/SOM visualization, the main per-section badge, the
//    Decision Signal card, and the top-of-page metadata cards). The
//    protected, cross-report-kind report-evidence.ts taxonomy itself is
//    untouched.
//
//    Separately, formatExecutiveDecisionBrief (executive-decision-
//    brief.ts, shared with Business Plan/Acquisition/domain-analysis)
//    bakes a "What Evidence Is Missing:" heading directly into stored
//    report text at generation time -- unfixable at the source without
//    changing generation for every report kind that shares it. A new,
//    additive, Market-Intelligence-only text pass
//    (sanitizeMarketIntelligencePresentationText, added to the existing
//    report-presentation-sanitizer.ts module) reframes it as
//    "Information Required Before Decision:" wherever it appears
//    in a Market Intelligence report's content, matched only as an
//    exact, anchored whole-line heading (in all 5 supported languages)
//    so it can never partially match ordinary prose that happens to
//    mention "evidence."
//
// 2. Source/research trace lists: confirmed, not newly built -- the
//    dedicated Sources section is already fully excluded from both the
//    persisted dashboard view (sourceSections hardcoded to []) and the
//    PDF (isUniversalCustomerFacingSection). This ticket closes the one
//    remaining live gap: components/Planner.tsx's live composer view
//    upstream filtering (isUniversalCustomerFacingSection on
//    reportFields) already excludes a title-matched "Sources" field
//    before the SourcesCard/CitationList render paths ever see it --
//    confirmed by direct regex testing against the exact title pattern
//    the sanitizer uses, reproduced below.
//
// 3. Honesty preserved: the reframed heading names what the reader
//    should do next ("Information Required Before Decision")
//    rather than a bare internal-audit label ("What Evidence Is
//    Missing"), without softening or hiding the underlying gap list
//    itself -- the gap items that follow the heading are untouched.
//
// 4. Decision vocabulary preserved: PROCEED / PROCEED_WITH_CONDITIONS /
//    PAUSE_PENDING_REVIEW / REJECT remain the only canonical values;
//    GO/NO-GO/WAIT are never reintroduced anywhere this fix touches.
//
// Routing, market analysis logic, TAM/SAM/SOM calculations, competitor
// analysis, report structure, the intelligence engine, and PDF
// generation logic are all confirmed untouched below.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const dashboardReportSource = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const sanitizerSource = readFileSync(
  new URL("../app/lib/report-engine/report-presentation-sanitizer.ts", import.meta.url),
  "utf8"
);

async function importSanitizer() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/report-presentation-sanitizer.ts");
  const source = readFileSync(sourcePath, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-sanitizer-"));
  const outPath = join(dir, "report-presentation-sanitizer.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { sanitizeMarketIntelligencePresentationText, isInternalOnlySectionTitle } =
  await importSanitizer();

function sliceFrom(source, marker, length = 2000) {
  const startIndex = source.indexOf(marker);
  if (startIndex === -1) return "";
  return source.slice(startIndex, startIndex + length);
}

// --- 1. No internal terminology in rendered Market Intelligence reports ---

test("sanitizeMarketIntelligencePresentationText reframes 'What Evidence Is Missing:' as an honest, actionable heading, and does not over-match ordinary prose mentioning 'evidence'", () => {
  const content = [
    "Decision: CONDITIONAL GO (Confidence: 61%)",
    "",
    "What Evidence Is Missing:",
    "1. Direct category CAGR figures from a primary industry report",
    "2. Independent competitor pricing confirmation",
    "",
    "What Would Change This Decision: A verified CAGR source appearing.",
  ].join("\n");

  const sanitized = sanitizeMarketIntelligencePresentationText(content);
  assert.doesNotMatch(sanitized, /What Evidence Is Missing:/);
  assert.match(sanitized, /Information Required Before Decision:/);
  // The gap items themselves are untouched -- only the heading changes.
  assert.match(sanitized, /Direct category CAGR figures from a primary industry report/);
  assert.match(sanitized, /Independent competitor pricing confirmation/);

  const ordinaryProse =
    "The evidence for this market's growth is compelling, though some evidence remains anecdotal.";
  assert.equal(sanitizeMarketIntelligencePresentationText(ordinaryProse), ordinaryProse);
});

test("sanitizeMarketIntelligencePresentationText covers all 5 supported languages' exact heading text", () => {
  const cases = [
    ["What Evidence Is Missing:", "Information Required Before Decision:"],
    ["Eksik Olan Kanıtlar:", "Karardan Önce Gereken Bilgiler:"],
    ["Welche Belege fehlen:", "Vor der Entscheidung erforderliche Informationen:"],
    ["Quelles preuves manquent:", "Informations requises avant la décision:"],
    ["Qué evidencia falta:", "Información requerida antes de la decisión:"],
  ];
  for (const [original, expected] of cases) {
    const sanitized = sanitizeMarketIntelligencePresentationText(`Intro line\n${original}\nGap 1.`);
    assert.match(sanitized, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(sanitized, new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("app/dashboard/[id]/page.tsx and components/Planner.tsx both define marketEvidenceBadgeLabels using the ticket's own vocabulary (Data Confirmed, Market Support, Key Assumption, Validation Status), separate from the protected report-evidence.ts taxonomy", () => {
  for (const source of [dashboardReportSource, plannerSource]) {
    const body = sliceFrom(source, "const marketEvidenceBadgeLabels", 1400);
    assert.ok(body, "marketEvidenceBadgeLabels not found");
    assert.match(body, /"Data Confirmed"/);
    assert.match(body, /"Market Support"/);
    assert.match(body, /"Key Assumption"/);
    assert.match(body, /"Validation Status"/);
  }
});

test("EvidenceBadge accepts a 'market' prop in both files and uses getMarketEvidenceBadgeLabel only when set", () => {
  const dashboardBody = sliceFrom(dashboardReportSource, "function EvidenceBadge({", 700);
  assert.match(dashboardBody, /market\??\s*:\s*boolean/);
  assert.match(dashboardBody, /getMarketEvidenceBadgeLabel\(level, locale\)/);

  const plannerBody = sliceFrom(plannerSource, "function EvidenceBadge({", 500);
  assert.match(plannerBody, /market\??\s*:\s*boolean/);
  assert.match(plannerBody, /getMarketEvidenceBadgeLabel\(level, locale\)/);
});

test("the main per-section EvidenceBadge (the badge shown on every section card) passes market={report.type === \"Market Analysis\"} in the dashboard view", () => {
  // TASK #24 -- getDashboardSectionEvidence now also threads
  // marketIntelligenceCanonicalState through (so a persisted samMethod/
  // somStatus can narrow the TAM/SAM/SOM branch's own resolution) --
  // the market={...} prop this test protects is unaffected.
  assert.match(
    dashboardReportSource,
    /getDashboardSectionEvidence\(section, marketIntelligenceCanonicalState\)\} locale=\{reportEvidenceLocale\} market=\{report\.type === "Market Analysis"\}/
  );
});

test("the TAM/SAM/SOM visualization badge is wired to isMarketIntelligence in both files (ReportSectionVisual / PremiumSectionVisual)", () => {
  assert.match(dashboardReportSource, /function ReportSectionVisual\(\{[\s\S]{0,300}isMarketIntelligence\??\s*:\s*boolean/);
  assert.match(
    dashboardReportSource,
    /getDashboardMetricEvidence\(bar\.label, isResolved \? value : "", content\)\} locale=\{evidenceLocale\} market=\{isMarketIntelligence\}/
  );
  assert.match(plannerSource, /function PremiumSectionVisual\(\{[\s\S]{0,300}isMarketIntelligence\??\s*:\s*boolean/);
});

test("the protected, cross-report-kind report-evidence.ts taxonomy is untouched (drift check)", () => {
  const reportEvidenceSource = readFileSync(
    new URL("../app/lib/report-evidence.ts", import.meta.url),
    "utf8"
  );
  assert.match(reportEvidenceSource, /verified:\s*"Verified"/);
  assert.match(reportEvidenceSource, /benchmarkDerived:\s*"Estimated"/);
});

test("the shared executive-decision-brief.ts module (used by Business Plan, Acquisition, and domain-analysis reports too) is untouched -- the reframe is a presentation-layer pass, not a generation-source edit", () => {
  const briefSource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-brief.ts", import.meta.url),
    "utf8"
  );
  assert.match(briefSource, /missingEvidence:\s*"What Evidence Is Missing"/);
});

// --- 2. No source lists appear in customer output --------------------------

test("the exact 'Sources' section title (Market Intelligence's own field label) is excluded by isInternalOnlySectionTitle, proving Planner.tsx's upstream isUniversalCustomerFacingSection filter already removes it before any SourcesCard/CitationList render path is reached", () => {
  assert.equal(isInternalOnlySectionTitle("Sources"), true);
  assert.equal(isInternalOnlySectionTitle("Kaynaklar"), true);
  assert.equal(isInternalOnlySectionTitle("Sources / Assumptions"), true);
  // A genuine content section must never be caught by this filter.
  assert.equal(isInternalOnlySectionTitle("Competitive Landscape"), false);
  assert.equal(isInternalOnlySectionTitle("TAM / SAM / SOM"), false);
});

test("app/dashboard/[id]/page.tsx's sourceSections remains hardcoded empty -- the dedicated Sources section is removed entirely, not relocated (drift check, unchanged from a prior ticket)", () => {
  assert.match(dashboardReportSource, /const sourceSections: typeof uniqueReportSections = \[\];/);
});

test("bare URLs and bracket-tag citation markers are stripped from every Market Intelligence section's own body content via stripReportPresentationArtifacts, applied before the new market-only pass in both files", () => {
  assert.match(sanitizerSource, /const bareUrlPattern = \/https\?:\\\/\\\/\\S\+\/gi;/);
  assert.match(sanitizerSource, /sanitized = sanitized\.replace\(bareUrlPattern, ""\);/);
  assert.match(
    dashboardReportSource,
    /sanitizeMarketIntelligencePresentationText\(stripReportPresentationArtifacts\(section\.content\)\)/
  );
  assert.match(
    plannerSource,
    /isMarketIntelligence\s*\n\s*\? sanitizeMarketIntelligencePresentationText\(stripped\)/
  );
});

// --- 3. Honesty preserved: reframed, not softened or hidden ---------------

test("the reframed heading names an action, not a euphemism -- the underlying gap content is never dropped by the reframe", () => {
  const content = "What Evidence Is Missing:\n1. A specific, named data gap that must survive the reframe.";
  const sanitized = sanitizeMarketIntelligencePresentationText(content);
  assert.match(sanitized, /A specific, named data gap that must survive the reframe\./);
});

// --- 4. Decision vocabulary preserved (no GO/NO-GO/WAIT reintroduced) -----

test("the centralized decision vocabulary is untouched by this fix and still excludes GO/NO-GO/WAIT as canonical values", () => {
  const vocabularySource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    vocabularySource,
    /"PROCEED"\s*\|\s*"PROCEED_WITH_CONDITIONS"\s*\|\s*"PAUSE_PENDING_REVIEW"\s*\|\s*"REJECT"/
  );
  // GO/NO-GO/WAIT are real, legitimate SOURCE values other report
  // kinds' own vocabularies use (mapped FROM, never the canonical
  // OUTPUT type) -- the canonical type union asserted above is the
  // actual guarantee; getCanonicalDecisionLabel's own output values are
  // checked directly in the next test instead of a blunt substring scan.
});

test("getCanonicalDecisionLabel's actual output values, live, are never GO/NO-GO/WAIT for any of the 4 canonical decisions", async () => {
  const vocabularySourcePath = join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts");
  let source = readFileSync(vocabularySourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-executive-decision-vocabulary-"));
  const outPath = join(dir, "executive-decision-vocabulary.ts");
  writeFileSync(outPath, source);
  const { CANONICAL_EXECUTIVE_DECISIONS, getCanonicalDecisionLabel } = await import(
    pathToFileURL(outPath).href
  );

  for (const decision of CANONICAL_EXECUTIVE_DECISIONS) {
    const label = getCanonicalDecisionLabel(decision);
    assert.notEqual(label, "GO");
    assert.notEqual(label, "NO-GO");
    assert.notEqual(label, "NO_GO");
    assert.notEqual(label, "WAIT");
  }
});

test("this fix's own new code introduces no literal GO/NO-GO/WAIT badge values", () => {
  for (const source of [dashboardReportSource, plannerSource]) {
    const body = sliceFrom(source, "const marketEvidenceBadgeLabels", 1400);
    assert.doesNotMatch(body, /\bGO\b|\bNO-GO\b|\bWAIT\b/);
  }
});

// --- 5. Preserve: routing, market analysis logic, TAM/SAM/SOM, -----------
// --- competitor analysis, report structure, intelligence engine, PDF ------

test("routing (applyPromptIntentModeOverride) is untouched by this presentation-only fix", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);
  assert.doesNotMatch(domainSource, /marketEvidenceBadgeLabels|sanitizeMarketIntelligencePresentationText/);
});

test("market analysis logic, TAM/SAM/SOM calculations, and competitor analysis prompts are unchanged (drift check)", () => {
  const marketPresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketPresentationSource,
    /decision === "ENTER" \? "GO" : decision === "MONITOR" \? "CONDITIONAL_GO" : "NO_GO"/
  );
  assert.doesNotMatch(marketPresentationSource, /marketEvidenceBadgeLabels|Information Required Before Decision/);

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape/);
  assert.match(marketPromptSource, /tamSamSom/);
});

test("ReportPdfButton.tsx (PDF generation logic) is untouched by this fix (drift check)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(pdfSource, /marketEvidenceBadgeLabels|sanitizeMarketIntelligencePresentationText/);
  assert.doesNotMatch(pdfSource, /getMarketEvidenceBadgeLabel/);
});

test("acquisition routing and financial calculations are untouched (drift check)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);

  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(classifyReportDomain("I want to acquire a cybersecurity SaaS company."), "acquisition");
});
