import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// FINAL FIX -- remove remaining internal intelligence terminology from
// Market Intelligence output.
//
// Builds on three prior Market Intelligence polish tickets. This one
// closes three concrete, newly-identified gaps:
//
// 1. "Evidence Count" (a literal competitor-comparison table column
//    header, app/lib/ai/market-intelligence-graph.ts's marketGraphCopy
//    dictionary -- a pure label/copy table, not analysis logic) read as
//    an internal audit metric on a customer-facing table. Renamed to
//    "Validation Count" (and its Turkish/German/French/Spanish
//    equivalents) -- the underlying count itself is unchanged, only the
//    column header.
// 2. Confirmed live: stripReportPresentationArtifacts already removes
//    bracket-tag citation IDs like [R1]/[R2] from an "Evidence: [R1],
//    [R2]" disclosure line, but that left a broken, dangling "Evidence:
//    ," or "Evidence: , ," fragment behind. A new,
//    Market-Intelligence-only pass (sanitizeMarketIntelligencePresentation
//    Text, extended from the prior ticket) removes the whole dangling
//    fragment -- no information is hidden that the universal pass
//    hadn't already stripped.
// 3. "Some external sources could not be verified, so..." (several
//    trailing-clause variants across report-output-sanitization.ts and
//    plan-executor.ts, all shared generation-time fallback text) is
//    replaced with the ticket's own canonical sentence: "Some
//    assumptions require additional validation before a final
//    conclusion." -- applied as the same kind of additive,
//    Market-Intelligence-only presentation pass as the heading reframe,
//    never editing the shared generation source.
// 4. "Market Infrastructure" -- a government/regulator/standards-body
//    sub-section -- was appended directly into the customer-visible
//    marketOverview field by applySharedMarketGraph in
//    app/api/market-analysis/route.ts (a file exclusive to Market
//    Intelligence, not shared with any other report kind). Fixed by no
//    longer merging it in; the underlying
//    graph.vendorIntelligence.marketInfrastructure computation itself
//    (research/analysis logic) is untouched.
//
// Routing, report classification, market analysis logic, competitor
// analysis logic, TAM/SAM/SOM calculation logic, the decision engine,
// and PDF structure are all confirmed untouched below.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const marketAnalysisRouteSource = readFileSync(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);
const marketGraphSource = readFileSync(
  new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
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

const { stripReportPresentationArtifacts, sanitizeMarketIntelligencePresentationText } =
  await importSanitizer();

function full(text) {
  return sanitizeMarketIntelligencePresentationText(stripReportPresentationArtifacts(text));
}

// --- 1. "Evidence Count" -> "Validation Count" ------------------------

test("market-intelligence-graph.ts's competitor-comparison table header no longer reads 'Evidence Count' in any of the 5 supported languages", () => {
  assert.doesNotMatch(marketGraphSource, /Evidence Count/);
  assert.doesNotMatch(marketGraphSource, /Kanıt Sayısı/);
  assert.doesNotMatch(marketGraphSource, /Anzahl Nachweise/);
  assert.doesNotMatch(marketGraphSource, /Nombre de preuves/);
  assert.doesNotMatch(marketGraphSource, /Cantidad de evidencia/);

  assert.match(marketGraphSource, /Validation Count/);
  assert.match(marketGraphSource, /Doğrulama Sayısı/);
  assert.match(marketGraphSource, /Validierungsanzahl/);
  assert.match(marketGraphSource, /Nombre de validations/);
  assert.match(marketGraphSource, /Cantidad de validación/);
});

// --- 2. Dangling 'Evidence: ,' artifacts removed -----------------------

test("a bracket-tag evidence-ID disclosure line ('Evidence: [R1], [R2]') no longer leaves a dangling 'Evidence: ,' fragment after sanitization", () => {
  const twoIds = full(
    "- [Verified] The market shows strong growth signals. | Confidence: 82/100 (High) | Evidence: [R1], [R2]"
  );
  assert.doesNotMatch(twoIds, /Evidence:/);
  assert.doesNotMatch(twoIds, /\|\s*,/);
  assert.match(twoIds, /The market shows strong growth signals\./);
  assert.match(twoIds, /Confidence: 82\/100 \(High\)/);

  const threeIds = full(
    "Confidence: 70/100 (Medium) | Basis: benchmark scaling | Evidence: [R3], [R4], [R5]"
  );
  assert.doesNotMatch(threeIds, /Evidence:/);
  assert.match(threeIds, /Confidence: 70\/100 \(Medium\)/);
  assert.match(threeIds, /Basis: benchmark scaling/);
});

test("ordinary prose mentioning 'evidence' is never touched by the dangling-fragment cleanup (no over-matching)", () => {
  const prose = "The evidence for this market's growth is compelling, though some evidence remains anecdotal.";
  assert.equal(full(prose), prose);
});

// --- 3. 'External sources could not be verified' reframed --------------

test("'Some external sources could not be verified, so...' (any trailing clause) is replaced with the ticket's exact canonical sentence", () => {
  const variants = [
    "Some external sources could not be verified, so this section does not contain a definitive conclusion.",
    "Some external sources could not be verified, so the affected sections are not definitive.",
  ];
  for (const variant of variants) {
    const sanitized = full(variant);
    assert.doesNotMatch(sanitized, /external sources could not be verified/i);
    assert.equal(sanitized, "Some assumptions require additional validation before a final conclusion.");
  }
});

test("the Turkish equivalent ('Bazı dış kaynaklar doğrulanamadığı için...') is reframed consistently", () => {
  const sanitized = full("Bazı dış kaynaklar doğrulanamadığı için bu bölüm kesin sonuç içermiyor.");
  assert.doesNotMatch(sanitized, /doğrulanamadığı/);
  assert.match(sanitized, /varsayımlar/);
});

// --- 4. 'Market Infrastructure' no longer appears in customer output ---

test("applySharedMarketGraph in app/api/market-analysis/route.ts no longer merges marketInfrastructure into the customer-visible marketOverview field", () => {
  const fnMatch = /function applySharedMarketGraph\([\s\S]*?\n}/.exec(marketAnalysisRouteSource);
  assert.ok(fnMatch, "applySharedMarketGraph not found");
  const body = fnMatch[0];
  assert.doesNotMatch(body, /marketOverview:\s*marketInfrastructure/);
  assert.doesNotMatch(body, /\$\{report\.marketOverview\}\\n\\n\$\{marketInfrastructure\}/);
  // marketInfrastructure is destructured out (and discarded) rather than
  // silently spread onto the report object.
  assert.match(body, /const \{ marketInfrastructure: _marketInfrastructure, \.\.\.reportFieldsFromGraph \} = projection;/);
});

test("the underlying marketInfrastructure computation itself (research/analysis logic) is untouched -- only its customer-facing merge is removed", () => {
  assert.match(marketGraphSource, /marketInfrastructure\?:\s*string/);
  assert.match(marketGraphSource, /graph\.vendorIntelligence\.marketInfrastructure/);
  assert.match(marketGraphSource, /marketInfrastructureTitle:\s*"Market Infrastructure"/);
});

// --- 5. Preserve: routing, classification, market analysis logic, -------
// --- competitor analysis, TAM/SAM/SOM, decision engine, PDF structure ----

test("routing and report classification (applyPromptIntentModeOverride, classifyReportDomain) are untouched by this presentation-only fix", () => {
  const domainSource = readFileSync(new URL("../app/lib/report-engine/domain.ts", import.meta.url), "utf8");
  assert.match(domainSource, /export function applyPromptIntentModeOverride/);
  assert.doesNotMatch(domainSource, /Validation Count|marketInfrastructure/);
});

test("the decision engine's ENTER/MONITOR/AVOID computation and GO/CONDITIONAL_GO/NO_GO mapping are unchanged (drift check)", () => {
  const marketPresentationSource = readFileSync(
    new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketPresentationSource,
    /decision === "ENTER" \? "GO" : decision === "MONITOR" \? "CONDITIONAL_GO" : "NO_GO"/
  );
});

test("the centralized decision vocabulary (PROCEED/PROCEED_WITH_CONDITIONS/PAUSE_PENDING_REVIEW/REJECT) is untouched", () => {
  const vocabularySource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    vocabularySource,
    /"PROCEED"\s*\|\s*"PROCEED_WITH_CONDITIONS"\s*\|\s*"PAUSE_PENDING_REVIEW"\s*\|\s*"REJECT"/
  );
});

test("competitor analysis and TAM/SAM/SOM field prompts, and vendor/competitor discovery logic, are unchanged (drift check)", () => {
  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /competitiveLandscape/);
  assert.match(marketPromptSource, /tamSamSom/);
  // The vendor-discovery/graph-building functions themselves (not just
  // the copy dictionary) are untouched by this presentation-only fix.
  assert.match(marketGraphSource, /function buildMarketIntelligenceGraph/);
  assert.match(marketGraphSource, /function projectMarketIntelligenceGraphToReport/);
});

test("ReportPdfButton.tsx (PDF structure) is untouched by this fix (drift check)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  // TASK #34 -- confirmed live (citation-integrity audit): ReportPdfButton.tsx
  // never called sanitizeMarketIntelligencePresentationText at all, a
  // genuine web/PDF asymmetry for Market Intelligence's own dangling
  // "| Evidence: ,"-shaped residue and internal heading relabeling --
  // fixed by deliberately wiring it in (see
  // tests/task34-citation-integrity-authoritative.test.mjs for that
  // fix's own dedicated coverage). "Validation Count" remains a real
  // drift check for this ticket's own, unrelated fix.
  assert.doesNotMatch(pdfSource, /Validation Count/);
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

// --- 6. Comprehensive final check: no named internal terms remain -------
// --- reachable in a rendered Market Intelligence report -----------------

test("a full, realistic Market Intelligence section, run through the actual render pipeline, contains none of the six named internal terms", () => {
  const rawSection = [
    "Decision: CONDITIONAL GO (Confidence: 61%)",
    "",
    "- [Verified] Category demand is growing. | Confidence: 74/100 (High) | Evidence: [R1], [R2]",
    "",
    "Some external sources could not be verified, so this section does not contain a definitive conclusion.",
    "",
    "What Evidence Is Missing:",
    "1. Direct category CAGR figures from a primary industry report",
  ].join("\n");

  const rendered = full(rawSection);

  assert.doesNotMatch(rendered, /\bEvidence\b/);
  assert.doesNotMatch(rendered, /\bVerified\b/);
  assert.doesNotMatch(rendered, /Missing Evidence/i);
  assert.doesNotMatch(rendered, /external sources could not be verified/i);
  // The decision line and the real gap content survive the cleanup.
  assert.match(rendered, /CONDITIONAL GO/);
  assert.match(rendered, /Direct category CAGR figures from a primary industry report/);
});
