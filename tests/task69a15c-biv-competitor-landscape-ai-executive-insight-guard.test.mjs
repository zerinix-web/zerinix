// TASK #69A-15C -- Trace and fix the real runtime corruption that turns
// Business Idea Validation Competitor Landscape into "AI Executive
// Insight".
//
// ROOT CAUSE (traced against real production data via a temporary,
// immediately-deleted service-role script, per this ticket's own "do not
// guess" requirement): the newest real report inspected did NOT contain a
// stale-cache or generation-schema defect at all -- Tier 0
// (competitorLandscapeStructured) and Tier 1 (labeled-line prose parse,
// business-competitor-landscape-state.ts) both legitimately came back
// empty, because this specific field fell back to plan-executor.ts's
// generic, no-named-entity skeleton sentence (`fallbackByField.competitorLandscape`,
// used whenever this ONE field's own generation genuinely produced
// nothing usable -- honest, intentional, and out of this ticket's scope).
// Every persisted competitorLandscape field -- generated OR fallback --
// then has plan-executor.ts's normalizeFullPlanReport deterministically
// append a trailing "AI Executive Insight:\n<insight sentence>" block
// (appendIntelligenceBlock, built entirely from investmentScore/financial-
// metric data) -- presentation metadata, never a competitor.
//
// With both structured tiers empty, every renderer's Tier 2
// extractCompetitorRows (Planner.tsx, page.tsx, ReportPdfButton.tsx --
// three independent copies) fell to its own last-resort per-line company
// guess. That guess (`/^([A-Z0-9][A-Za-z0-9 .&()\/-]{1,42})\s*[:—–-]\s+/`)
// matched the appended block's own "AI Executive Insight: " prefix, and
// isImplausibleCompetitorNameOnScreen never rejected it (no instruction
// verb, no URL, <=6 words) -- producing exactly the reported symptom: one
// fabricated "AI Executive Insight" row, every other cell "—", while any
// real competitor names elsewhere in the (in this case generic) content
// were never found because none existed to find.
//
// FIX: "AI Executive Insight" / "AI Yönetici İçgörüsü" (the exact,
// deterministic, localized title appendIntelligenceBlock always uses for
// this field) added to competitorFieldLabels in all three renderer files
// -- the SAME exact-match mechanism #69A-14 already established for this
// identical class of bug (a known non-competitor label mistaken for an
// entity name) -- plus a defense-in-depth exact-match reject inside the
// shared isImplausibleCompetitorNameOnScreen gate itself, in case a
// future extraction path calls that gate without also consulting
// competitorFieldLabels. Neither change touches Tier 0/Tier 1
// (business-competitor-landscape-state.ts), the generation prompt/schema,
// or Market Intelligence's own, separate isImplausibleCompetitorNamePdf.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const reportPdfButtonSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"),
  "utf8"
);
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");

// --- Real-function-extraction harness, identical to task69a14's own -----
// (this ticket's fix lives in the exact same three functions that test
// file already proved this technique works against).

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;

  let parenIndex = source.indexOf("(", start);
  let parenDepth = 0;
  for (; parenIndex < source.length; parenIndex++) {
    if (source[parenIndex] === "(") parenDepth++;
    if (source[parenIndex] === ")") {
      parenDepth--;
      if (parenDepth === 0) break;
    }
  }

  let i = source.indexOf("{", parenIndex);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }

  return source.slice(start, i + 1);
}

function extractConstSource(source, name) {
  const startMatch = source.match(new RegExp(`const ${name} = \\[`));
  assert.notEqual(startMatch, null, `${name} not found`);
  const start = startMatch.index;
  const end = source.indexOf("];", start) + 2;
  return source.slice(start, end);
}

function stripTsTypes(text) {
  return text
    .replace(/(\w+): "[^"]+"(?:\s*\|\s*"[^"]+")+/g, "$1")
    .replace(/(\w+): string\[\]/g, "$1")
    .replace(/(\w+): string/g, "$1")
    .replace(/: Array<\{[\s\S]*?\}> = \[\]/g, " = []")
    .replace(/(\w+): \w+(?:<[^>]*>)? \| null;/g, "$1;")
    .replace(/new Set<[^>]*>\(\)/g, "new Set()");
}

async function loadRealCompetitorExtraction(source) {
  const escapeRegExp = stripTsTypes(extractFunctionSource(source, "escapeRegExp"));
  const competitorFieldLabels = extractConstSource(source, "competitorFieldLabels");
  const parseInlineField = stripTsTypes(extractFunctionSource(source, "parseInlineField"));
  const cleanExecutiveText = stripTsTypes(extractFunctionSource(source, "cleanExecutiveText"));
  const isImplausibleCompetitorNameOnScreen = stripTsTypes(
    extractFunctionSource(source, "isImplausibleCompetitorNameOnScreen")
  );
  const extractCompetitorRows = stripTsTypes(extractFunctionSource(source, "extractCompetitorRows"));

  const pdfNormUrl = pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href;
  const fullSource = [
    `import { normalizePdfText } from ${JSON.stringify(pdfNormUrl)};`,
    escapeRegExp,
    competitorFieldLabels,
    parseInlineField,
    cleanExecutiveText,
    isImplausibleCompetitorNameOnScreen,
    extractCompetitorRows,
    "export { extractCompetitorRows, isImplausibleCompetitorNameOnScreen, competitorFieldLabels };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-15c-competitor-"));
  const outPath = join(dir, "competitor-extraction.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

async function loadRealPdfCompetitorExtraction(source) {
  const escapeRegExp = stripTsTypes(extractFunctionSource(source, "escapeRegExp"));
  const competitorFieldLabels = extractConstSource(source, "competitorFieldLabels");
  const parseInlineCompetitorField = stripTsTypes(
    extractFunctionSource(source, "parseInlineCompetitorField")
  );
  const cleanPdfExecutiveText = stripTsTypes(extractFunctionSource(source, "cleanPdfExecutiveText"));
  const isImplausibleCompetitorNameOnScreen = stripTsTypes(
    extractFunctionSource(source, "isImplausibleCompetitorNameOnScreen")
  );
  const extractCompetitorRows = stripTsTypes(extractFunctionSource(source, "extractCompetitorRows"));

  const pdfNormUrl = pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href;
  const fullSource = [
    `import { normalizePdfText } from ${JSON.stringify(pdfNormUrl)};`,
    escapeRegExp,
    competitorFieldLabels,
    parseInlineCompetitorField,
    cleanPdfExecutiveText,
    isImplausibleCompetitorNameOnScreen,
    extractCompetitorRows,
    "export { extractCompetitorRows, isImplausibleCompetitorNameOnScreen, competitorFieldLabels };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-15c-pdf-competitor-"));
  const outPath = join(dir, "pdf-competitor-extraction.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

// --- Real fixtures -------------------------------------------------------

// Verbatim (structure preserved, only whitespace/newlines matching the
// real persisted shape) from the real production report inspected for
// this ticket: plan-executor.ts's own generic, named-entity-free
// competitorLandscape fallback sentence, followed by the deterministic
// appendIntelligenceBlock suffix -- the EXACT real failure mechanism, not
// a hypothetical fixture.
const REAL_FALLBACK_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE =
  "Direct competitors, substitutes, and status-quo alternatives within AI software / automation should be mapped against this business's specific wedge.\nThe detected subscription software model suggests differentiation is more likely to come from execution and distribution than from a generic feature gap.\n\nAI Executive Insight:\nAI Executive Insight: Competitive positioning matters because capital should only be committed once this is complete: Validate pricing, buyer urgency, and repeatable acquisition before committing full funding.\nConfirm it holds against the 11.3 months payback and 19.3 months runway.";

// The Turkish-localized equivalent (reportLabel's other branch) -- same
// deterministic shape, different language.
const REAL_FALLBACK_WITH_TURKISH_AI_EXECUTIVE_INSIGHT_FIXTURE =
  "Bu iş için doğrudan rakipler, ikame ürünler ve mevcut durum alternatifleri belirlenmelidir.\n\nAI Yönetici İçgörüsü:\nAI Yönetici İçgörüsü: Rekabet konumlandırması önemlidir çünkü sermaye ancak şu adım tamamlandıktan sonra ayrılmalıdır: Fiyatlandırmayı doğrulayın.\nBunu 11.3 ay geri ödeme süresine göre doğrulayın.";

// Verbatim from a real cached report (see task69a13/14/15/15a's own
// identical fixture) -- real, named competitors, WITH the same
// deterministic AI Executive Insight suffix appended, exactly as
// normalizeFullPlanReport produces for every competitorLandscape field
// regardless of whether generation succeeded or fell back.
const REAL_FLOAT_CASH_FLOW_FROG_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE =
  "Direct competitors: Float (targets finance teams in SMBs; scenario planning; QuickBooks/Xero/FreeAgent integrations; pricing tiers referenced) [R56][R59]. Cash Flow Frog (SMB focus; QuickBooks Desktop/QBO/Xero/Plaid integrations; low-cost tiers) [R57]. Substitutes: bookkeeping firms, Excel templates, advisory services.\n\nAI Executive Insight:\nAI Executive Insight: Competitive positioning matters because capital should only be committed once this is complete: Validate pricing, buyer urgency, and repeatable acquisition before committing full funding.\nConfirm it holds against the 11.3 months payback and 19.3 months runway.";

// Legacy fixture (#69A-14's own category-label-as-company regression) --
// must still be guarded exactly as before; this fix must not weaken it.
const CATEGORY_LABEL_PER_LINE_FIXTURE = [
  "Direct competitors: Float (targets finance teams in SMBs; scenario planning; QuickBooks/Xero/FreeAgent integrations; pricing tiers referenced) [R56][R59]. Cash Flow Frog (SMB focus; QuickBooks Desktop/QBO/Xero/Plaid integrations; low-cost tiers) [R57].",
  "Substitutes: bookkeeping firms, Excel templates, advisory services.",
  "Pricing: vendor anchors show low-tier SMB pricing ($33/mo) and higher plan tiers (~$59+/mo); premium FP&A pricing observed in category materials (investor slides cite larger TAM) [R56][R58].",
  "Strengths of incumbents: product-market fit, integrations, accountant channel.",
  "Weaknesses: limited AI prescriptive recommendations and enterprise-tier advisory.",
].join("\n");

// A legacy-persisted-report fixture with NO appended AI Executive Insight
// block at all (predates appendIntelligenceBlock's own introduction) --
// requirement G, must still render safely/unchanged.
const LEGACY_NO_INSIGHT_BLOCK_FIXTURE =
  "Direct competitors: Float (targets finance teams in SMBs; scenario planning) [R56]. Cash Flow Frog (SMB focus; low-cost tiers) [R57]. Substitutes: bookkeeping firms.";

let planner;
let page;
let pdf;

test.before(async () => {
  planner = await loadRealCompetitorExtraction(plannerSource);
  page = await loadRealCompetitorExtraction(pageSource);
  pdf = await loadRealPdfCompetitorExtraction(reportPdfButtonSource);
});

// Thunks, not direct values -- these test bodies run AFTER test.before
// resolves, but the `for` loops that register them (below) run at
// synchronous module-load time, before planner/page/pdf are assigned.
// Mirrors task69a14's own identical `() => plannerExtractCompetitorRows`
// pattern for the exact same reason.
const renderers = () => [
  ["Planner.tsx", () => planner, "—"],
  ["page.tsx", () => page, "—"],
  // ReportPdfButton.tsx's own extractCompetitorRows uses a different,
  // pre-existing missing-value convention ("Validation required" instead
  // of "—") -- untouched by this fix, just a real difference this test
  // must account for.
  ["ReportPdfButton.tsx", () => pdf, "Validation required"],
];

// --- Root cause confirmation (final-report items 1/2/3) ------------------

test("root cause confirmation: plan-executor.ts's fallbackByField.competitorLandscape is a generic, named-entity-free sentence (the real content this ticket's bug fixture reproduces)", () => {
  const match = /competitorLandscape: `Direct competitors, substitutes, and status-quo alternatives within \$\{industryLabel\}/.exec(
    planExecutorSource
  );
  assert.ok(match, "expected the real generic competitorLandscape fallback sentence to still exist unchanged");
});

test("root cause confirmation: appendIntelligenceBlock deterministically appends a trailing '<title>:\\n<lines>' block to competitorLandscape, and its title for this field is exactly the localized 'AI Executive Insight' label", () => {
  assert.match(
    planExecutorSource,
    /normalized\.competitorLandscape = appendIntelligenceBlock\(\s*\n\s*normalized\.competitorLandscape,\s*\n\s*reportLabel\(language, "AI Executive Insight", "AI Yönetici İçgörüsü"\),/
  );
  assert.match(
    planExecutorSource,
    /return `\$\{content\.trim\(\)\}\\n\\n\$\{title\}:\\n\$\{cleanLines\.join\("\\n"\)\}`\.trim\(\);/
  );
});

// --- Requirement B: "AI Executive Insight" cannot become company --------

for (const [name, mod] of renderers()) {
  test(`requirement B (${name}): the real, un-mocked extractCompetitorRows produces NO row named "AI Executive Insight" for the real fallback-plus-insight-block fixture`, () => {
    const rows = mod().extractCompetitorRows(REAL_FALLBACK_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE);
    const companies = rows.map((row) => row.company.toLowerCase());
    assert.ok(
      !companies.includes("ai executive insight"),
      `"AI Executive Insight" must never appear as a company, got: ${JSON.stringify(rows.map((r) => r.company))}`
    );
  });

  test(`requirement B (${name}, Turkish): the localized "AI Yönetici İçgörüsü" heading also cannot become a company`, () => {
    const rows = mod().extractCompetitorRows(REAL_FALLBACK_WITH_TURKISH_AI_EXECUTIVE_INSIGHT_FIXTURE);
    const companies = rows.map((row) => row.company.toLowerCase());
    // Compared via .toLowerCase() on both sides -- "İ" (Turkish dotted
    // capital I) lowercases to "i̇" (i + combining dot above), not plain
    // ASCII "i", so a hand-typed lowercase literal would silently never
    // match and give a false pass here.
    assert.ok(!companies.includes("AI Yönetici İçgörüsü".toLowerCase()));
  });

  test(`requirement B (${name}): isImplausibleCompetitorNameOnScreen itself rejects "AI Executive Insight" and "AI Yönetici İçgörüsü" as bare candidate names (defense-in-depth layer)`, () => {
    assert.equal(mod().isImplausibleCompetitorNameOnScreen("AI Executive Insight"), true);
    assert.equal(mod().isImplausibleCompetitorNameOnScreen("AI Yönetici İçgörüsü"), true);
  });

  test(`requirement B (${name}): competitorFieldLabels contains the exact labels appendIntelligenceBlock uses for this field`, () => {
    const labels = mod().competitorFieldLabels.map((label) => label.toLowerCase());
    assert.ok(labels.includes("ai executive insight"));
    assert.ok(labels.includes("AI Yönetici İçgörüsü".toLowerCase()));
  });

  // --- Requirement 5 (no fabrication when nothing real exists) --------

  test(`requirement 5/7 (${name}): when the underlying content has no real, named competitor entity at all (the generic fallback case), extractCompetitorRows returns ZERO rows -- never a fabricated "AI Executive Insight" placeholder, never any invented company`, () => {
    const rows = mod().extractCompetitorRows(REAL_FALLBACK_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE);
    assert.deepEqual(rows, [], `expected no rows at all for content with no real competitor entity, got: ${JSON.stringify(rows)}`);
  });
}

// --- Requirement C: other presentation headings still guarded -----------

for (const [name, mod] of renderers()) {
  test(`requirement C (${name}): pre-existing #69A-14 category-heading guard (Direct competitors/Substitutes/Pricing/Strengths of incumbents/Weaknesses) is unweakened by this fix`, () => {
    const rows = mod().extractCompetitorRows(CATEGORY_LABEL_PER_LINE_FIXTURE);
    const companies = rows.map((row) => row.company.toLowerCase());
    for (const forbidden of ["direct competitors", "substitutes", "pricing", "strengths of incumbents", "weaknesses"]) {
      assert.ok(!companies.includes(forbidden), `"${forbidden}" leaked through as a company in ${name}`);
    }
  });
}

// --- Requirement D: Float / Cash Flow Frog retain distinct rows ---------

for (const [name, mod, missingMarker] of renderers()) {
  test(`requirement D (${name}): Float and Cash Flow Frog remain two distinct, real company rows even WITH the appended AI Executive Insight block present in the same content`, () => {
    const rows = mod().extractCompetitorRows(REAL_FLOAT_CASH_FLOW_FROG_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE);
    const companies = rows.map((row) => row.company);
    assert.ok(companies.some((c) => c.includes("Float")), `expected a Float row, got: ${JSON.stringify(companies)}`);
    assert.ok(companies.some((c) => c.includes("Cash Flow Frog")), `expected a Cash Flow Frog row, got: ${JSON.stringify(companies)}`);
    assert.ok(!companies.some((c) => c.toLowerCase().includes("ai executive insight")));
    // Never merged into one row.
    assert.notEqual(
      rows.find((r) => r.company.includes("Float")),
      rows.find((r) => r.company.includes("Cash Flow Frog"))
    );
  });

  // --- Requirement E: positioning never leaks into other fields -------

  test(`requirement E (${name}): Float's own row keeps positioning distinct from strengths/weaknesses/threat (never copied)`, () => {
    const rows = mod().extractCompetitorRows(REAL_FLOAT_CASH_FLOW_FROG_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE);
    const float = rows.find((r) => r.company.includes("Float"));
    assert.ok(float);
    assert.notEqual(float.positioning, float.strengths);
    assert.notEqual(float.positioning, float.weaknesses);
    assert.notEqual(float.positioning, float.threat);
  });

  // --- Requirement F: genuinely missing fields stay "—" ----------------

  test(`requirement F (${name}): fields this extraction tier cannot support (strengths/weaknesses/threat, never labeled per-competitor in this prose shape) honestly render this renderer's own missing-value marker, never fabricated`, () => {
    const rows = mod().extractCompetitorRows(REAL_FLOAT_CASH_FLOW_FROG_WITH_AI_EXECUTIVE_INSIGHT_FIXTURE);
    const float = rows.find((r) => r.company.includes("Float"));
    assert.equal(float.strengths, missingMarker);
    assert.equal(float.weaknesses, missingMarker);
    assert.equal(float.threat, missingMarker);
  });
}

// --- Requirement G: legacy persisted reports remain safe -----------------

for (const [name, mod] of renderers()) {
  test(`requirement G (${name}): a legacy report with no appended AI Executive Insight block at all still extracts Float/Cash Flow Frog exactly as before this fix`, () => {
    const rows = mod().extractCompetitorRows(LEGACY_NO_INSIGHT_BLOCK_FIXTURE);
    const companies = rows.map((row) => row.company);
    assert.ok(companies.some((c) => c.includes("Float")));
    assert.ok(companies.some((c) => c.includes("Cash Flow Frog")));
  });
}

// --- Requirement H: Market Intelligence untouched -------------------------

test("requirement H: ReportPdfButton.tsx's OWN, separate Market-Intelligence-only isImplausibleCompetitorNamePdf function is byte-unchanged by this fix (no #69A-15C marker, no new AI-Executive-Insight guard added there)", () => {
  const fnSource = extractFunctionSource(reportPdfButtonSource, "isImplausibleCompetitorNamePdf");
  assert.doesNotMatch(fnSource, /#69A-15C/);
  assert.doesNotMatch(fnSource, /ai executive insight|ai yönetici içgörüsü/i);
});

test("requirement H: no Market Intelligence file carries a #69A-15C marker", () => {
  for (const relativePath of [
    "app/lib/ai/market-intelligence-graph.ts",
    "app/lib/ai/vendor-intelligence.ts",
    "app/lib/ai/vendor-discovery.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-15C/);
  }
});

// --- Requirement I: canonical authority/financial/decision systems -------

test("requirement I: no canonical decision/confidence/evidence-provenance/financial/TAM-SAM-SOM/Founder-Readiness/Unit-Economics/PDF-numeric file carries a #69A-15C marker", () => {
  for (const relativePath of [
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/report-consistency-validation.ts",
    "app/lib/report-investment-score.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-15C/);
  }
});

test("requirement I: plan-executor.ts's own #69A-15C changes are confined to normalizeFullPlanReport's already-existing appendIntelligenceBlock call and comments -- no new call site, no change to appendIntelligenceBlock's own logic, buildExecutiveInsight, or the generation/schema/cache-key code from #69A-15/15A/15B", () => {
  const markerCount = (planExecutorSource.match(/#69A-15C/g) || []).length;
  assert.equal(markerCount, 0, "this fix requires no change inside plan-executor.ts itself -- the corruption is a renderer-side (Tier 2) defect, not a generation-side one");
  // #69A-15A/15B's own load-bearing mechanisms remain byte-present.
  assert.match(
    planExecutorSource,
    /format: createFullReportJsonSchema\(\s*\n\s*"zerinix_business_plan_report",\s*\n\s*\[\.\.\.planFields, "competitorLandscapeStructured"\],/
  );
  // Version-tolerant: TASK #69A-16 legitimately bumped this v1 -> v2 for
  // an unrelated (prompt-strengthening) contract change; this test's own
  // concern is only that the mechanism still exists, not its exact value.
  assert.match(planExecutorSource, /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "competitor-structured-v\d+";/);
});

// --- Tier 0 / Tier 1 untouched (business-competitor-landscape-state.ts) --

test("preserves #69A-15/15A/15B: business-competitor-landscape-state.ts carries no #69A-15C marker -- this fix never needed to touch Tier 0/Tier 1 at all, since neither tier's strict parsing shape can ever match the appended AI Executive Insight block in the first place", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"), "utf8");
  assert.doesNotMatch(source, /#69A-15C/);
});
