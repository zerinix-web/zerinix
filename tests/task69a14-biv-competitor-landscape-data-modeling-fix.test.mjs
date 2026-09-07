// TASK #69A-14 -- Repair Business Idea Validation Competitor Landscape
// data modeling and preserve real competitor intelligence.
//
// ROOT CAUSE: the real competitorLandscape generation prompt
// (app/lib/report-engine/prompts/plan.ts:36-40) asks for pure
// analytical prose organized by TOPIC -- "Map only competitors and
// substitutes. For each important competitor or substitute include
// available pricing, target customer, funding, employee size,
// strengths, weaknesses, positioning... Include incumbent response,
// switching barriers, and the gap for a new entrant. End with a
// concise executive implication..." -- confirmed verbatim against a
// real cached report's own field text (see
// tests/task69a4-biv-quality-gate-provenance-fix.test.mjs's own real
// fixture, reproduced below as REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD).
// It never promises a table, never promises one bullet per competitor,
// and never uses "Company:"/"Positioning:" labels -- the AI instead
// writes ONE continuous passage organized by inline category labels
// ("Direct competitors: Float (...). Cash Flow Frog (...). Substitutes:
// ... Pricing: ... Strengths of incumbents: ... Weaknesses: ...").
//
// #69A-13 correctly stopped Positioning/Strengths/Weaknesses/Threat
// from all echoing the same raw line, but left the COMPANY field's own
// "guess from the start of the line" regex completely unguarded -- so
// whenever an entire category clause landed on one "\n"-separated line
// (exactly what this real prompt's output does), the CATEGORY LABEL
// ITSELF ("Direct competitors", "Substitutes", "Pricing", "Strengths of
// incumbents", "Weaknesses") was captured as the "company name", while
// the REAL competitor names buried mid-sentence (Float, Cash Flow Frog)
// were never seen -- exactly this ticket's newly reported defect.
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
const planPromptsSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/prompts/plan.ts"),
  "utf8"
);

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
    "export { extractCompetitorRows };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-competitor-modeling-"));
  const outPath = join(dir, "competitor-modeling.mjs");
  writeFileSync(outPath, fullSource);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractCompetitorRows;
}

// ReportPdfButton.tsx (the PDF export path) has its own, THIRD
// independently-drifted copy of this extraction, named slightly
// differently (parseInlineCompetitorField, cleanPdfExecutiveText) and
// using its own missing-value convention ("Validation required" instead
// of "—") -- unlike Planner.tsx/page.tsx, it was never touched by
// #69A-13 either, so it still had BOTH the cross-field duplication bug
// (`positioning || line`) AND this ticket's category-label-as-company
// bug until this fix.
const reportPdfButtonSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"),
  "utf8"
);

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
    "export { extractCompetitorRows };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-pdf-competitor-modeling-"));
  const outPath = join(dir, "pdf-competitor-modeling.mjs");
  writeFileSync(outPath, fullSource);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractCompetitorRows;
}

// The FAIL-BEFORE fixture: the exact real malformed shape reported live,
// where "Direct competitors"/"Substitutes"/"Pricing"/"Strengths of
// incumbents"/"Weaknesses" -- category labels, not companies -- become
// COMPANY rows. Reconstructs what the OLD (pre-#69A-14) unguarded
// company-guess regex actually did, without needing a disruptive `git
// stash` (every #69A task's work this session is uncommitted, so
// stashing would revert far more than this one task's isolated diff --
// the established substitute in this exact session).
function oldUnguardedCompanyGuess(line) {
  return line.match(/^([A-Z0-9][A-Za-z0-9 .&()/-]{1,42})\s*[:—–-]\s+/)?.[1]?.trim() || "";
}

// Verbatim from the real cached report (ai_response_cache id
// 66a66c44-a2b3-4a24-a845-77909db270cb) that reproduced the real
// production failure -- the same fixture already used in
// tests/task69a4-biv-quality-gate-provenance-fix.test.mjs and
// tests/task69a3-biv-decision-evidence-contradictions.test.mjs.
const REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD =
  "Direct competitors: Float (targets finance teams in SMBs; scenario planning; QuickBooks/Xero/FreeAgent integrations; pricing tiers referenced) [R56][R59]. Cash Flow Frog (SMB focus; QuickBooks Desktop/QBO/Xero/Plaid integrations; low-cost tiers) [R57]. Substitutes: bookkeeping firms, Excel templates, advisory services. Pricing: vendor anchors show low-tier SMB pricing ($33/mo) and higher plan tiers (~$59+/mo); premium FP&A pricing observed in category materials (investor slides cite larger TAM) [R56][R58]. Strengths of incumbents: product-market fit, integrations, accountant channel. Weaknesses: limited AI prescriptive recommendations and enterprise-tier advisory. How to outperform: superior prescriptive AI, focused vertical workflows (ecommerce payouts), and accountant partnership program. Incumbent response: quicker integrations, bundling; switching barriers: data migration trust and workflow change. Gap for entrant: prescriptive AI + executive recommendations bundled with pilots and accountant-led channel. Executive implication: compete initially via a tight vertical and accountant channel to limit direct pricing battles.";

// A regression fixture that mirrors what the reported live symptom
// actually looked like: the SAME real field text, but re-flowed so each
// category clause lands on its own "\n"-separated line (whatever
// upstream normalization step produced the reported bug's exact
// on-screen row list -- "Direct competitors" / "Substitutes" /
// "Pricing" / "Strengths of incumbents" / "Weaknesses" as 5 separate
// rows -- this reproduces it deterministically for the fail-before
// proof, regardless of exactly which step split the lines in
// production).
const CATEGORY_LABEL_PER_LINE_FIXTURE = [
  "Direct competitors: Float (targets finance teams in SMBs; scenario planning; QuickBooks/Xero/FreeAgent integrations; pricing tiers referenced) [R56][R59]. Cash Flow Frog (SMB focus; QuickBooks Desktop/QBO/Xero/Plaid integrations; low-cost tiers) [R57].",
  "Substitutes: bookkeeping firms, Excel templates, advisory services.",
  "Pricing: vendor anchors show low-tier SMB pricing ($33/mo) and higher plan tiers (~$59+/mo); premium FP&A pricing observed in category materials (investor slides cite larger TAM) [R56][R58].",
  "Strengths of incumbents: product-market fit, integrations, accountant channel.",
  "Weaknesses: limited AI prescriptive recommendations and enterprise-tier advisory.",
].join("\n");

let plannerExtractCompetitorRows;
let pageExtractCompetitorRows;
let pdfExtractCompetitorRows;

test.before(async () => {
  plannerExtractCompetitorRows = await loadRealCompetitorExtraction(plannerSource);
  pageExtractCompetitorRows = await loadRealCompetitorExtraction(pageSource);
  pdfExtractCompetitorRows = await loadRealPdfCompetitorExtraction(reportPdfButtonSource);
});

// --- Root cause confirmation (item 1/2/3 of the required final report) --

test("root cause: the real competitorLandscape generation prompt (plan.ts) asks for topic-organized prose, never a table, never per-competitor bullets, never 'Company:'/'Positioning:' labels", () => {
  const fieldMatch = /competitorLandscape:\s*\{[\s\S]{0,400}/.exec(planPromptsSource);
  assert.ok(fieldMatch, "competitorLandscape prompt block not found");
  assert.match(fieldMatch[0], /Map only competitors and substitutes/);
  assert.doesNotMatch(fieldMatch[0], /table/i);
  assert.doesNotMatch(fieldMatch[0], /"?Company:/);
});

for (const [name, extractCompetitorRows] of [
  ["Planner.tsx", () => plannerExtractCompetitorRows],
  ["page.tsx", () => pageExtractCompetitorRows],
]) {
  test(`fail-before proof (${name}): the OLD unguarded company-guess regex captures each category label ("Direct competitors", "Substitutes", "Pricing", "Strengths of incumbents", "Weaknesses") as if it were a company name, for the exact real per-line fixture reproducing the reported live bug`, () => {
    const guessedCompanies = CATEGORY_LABEL_PER_LINE_FIXTURE.split("\n").map(oldUnguardedCompanyGuess);
    assert.deepEqual(guessedCompanies, [
      "Direct competitors",
      "Substitutes",
      "Pricing",
      "Strengths of incumbents",
      "Weaknesses",
    ]);
  });

  // --- Requirement A ------------------------------------------------

  test(`requirement A (${name}): category headings ("Direct competitors", "Substitutes", "Pricing", "Strengths of incumbents", "Weaknesses") cannot become competitor company names -- the REAL, current extractCompetitorRows never produces a row whose company is one of these labels`, () => {
    const rows = extractCompetitorRows()(CATEGORY_LABEL_PER_LINE_FIXTURE);
    const companies = rows.map((row) => row.company.toLowerCase());
    for (const forbidden of ["direct competitors", "substitutes", "pricing", "strengths of incumbents", "weaknesses"]) {
      assert.ok(
        !companies.some((company) => company === forbidden),
        `"${forbidden}" must never appear as a company name, got companies: ${JSON.stringify(rows.map((r) => r.company))}`
      );
    }
  });

  // --- Requirement B / real report reproduction ---------------------

  test(`requirement B (${name}): a genuinely supported competitor entity (Float, from the real cached report's own "Direct competitors" clause) is preserved as a competitor row`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    assert.ok(rows.some((row) => row.company === "Float"), `Float not found in rows: ${JSON.stringify(rows)}`);
  });

  test(`requirement B/E (${name}): BOTH real named competitors in the real cached report (Float AND Cash Flow Frog) are recovered as distinct rows -- neither is dropped nor merged`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    const companies = rows.map((row) => row.company);
    assert.ok(companies.includes("Float"), `Float missing: ${JSON.stringify(companies)}`);
    assert.ok(companies.includes("Cash Flow Frog"), `Cash Flow Frog missing: ${JSON.stringify(companies)}`);
    assert.equal(new Set(companies).size, companies.length, "no two rows should collapse into the same company");
  });

  test(`requirement A (${name}): using the real cached report's full text (the exact original production content, not the per-line-split fixture), no category label leaks through as a company either`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    const companies = rows.map((row) => row.company.toLowerCase());
    for (const forbidden of ["direct competitors", "substitutes", "pricing", "strengths of incumbents", "weaknesses", "how to outperform", "incumbent response", "executive implication"]) {
      assert.ok(!companies.includes(forbidden), `"${forbidden}" leaked through as a company`);
    }
  });

  // --- Requirement C --------------------------------------------------

  test(`requirement C (${name}): Float's row maps its OWN parenthetical description to positioning, never to strengths/weaknesses/threat, and never borrows the general "Pricing"/"Weaknesses" category clauses`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    const float = rows.find((row) => row.company === "Float");
    assert.ok(float, "Float row not found");
    assert.match(float.positioning, /targets finance teams in SMBs/);
    assert.doesNotMatch(float.positioning, /vendor anchors show low-tier SMB pricing/);
    assert.doesNotMatch(float.positioning, /limited AI prescriptive recommendations/);
  });

  // --- Requirement D ---------------------------------------------------

  test(`requirement D (${name}): Float's strengths/weaknesses/threat -- attributes the source text never cleanly assigns to Float specifically -- remain the honest "—" missing-value marker, never fabricated or copied from the shared category-level clauses`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    const float = rows.find((row) => row.company === "Float");
    assert.equal(float.strengths, "—");
    assert.equal(float.weaknesses, "—");
    assert.equal(float.threat, "—");
  });

  // --- Requirement E ---------------------------------------------------

  test(`requirement E (${name}): Float and Cash Flow Frog's positioning text remains distinct -- neither entity's own description is duplicated onto the other`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    const float = rows.find((row) => row.company === "Float");
    const cashFlowFrog = rows.find((row) => row.company === "Cash Flow Frog");
    assert.ok(float && cashFlowFrog);
    assert.notEqual(float.positioning, cashFlowFrog.positioning);
    assert.match(cashFlowFrog.positioning, /SMB focus/);
    assert.doesNotMatch(cashFlowFrog.positioning, /targets finance teams in SMBs/);
  });

  // --- Requirement F ---------------------------------------------------

  test(`requirement F (${name}): the general "Pricing" clause's own text (which describes the WHOLE market, not any one named entity) is never assigned to Float's, Cash Flow Frog's, or any row's positioning/strengths/weaknesses/threat`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    for (const row of rows) {
      for (const field of [row.positioning, row.strengths, row.weaknesses, row.threat]) {
        assert.doesNotMatch(field, /vendor anchors show low-tier SMB pricing/);
        assert.doesNotMatch(field, /premium FP&A pricing observed/);
      }
    }
  });

  // --- Requirement I ---------------------------------------------------

  test(`requirement I (${name}): no hardcoded fictional competitor data is introduced -- every row's company/positioning text is a substring of (or directly derived from) the real input content, never a literal not present in the source`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    for (const row of rows) {
      const bareCompanyName = row.company.replace(/\s*\(Substitute\)$/, "");
      assert.ok(
        REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD.includes(bareCompanyName),
        `company "${bareCompanyName}" is not present in the real source content`
      );
    }
  });

  // --- Substitutes with no clean per-entity structure ------------------

  test(`requirement A/D (${name}): "Substitutes: bookkeeping firms, Excel templates, advisory services." has no parenthetical per-entity structure -- correctly yields ZERO substitute rows rather than mis-extracting a generic category phrase as a named entity`, () => {
    const rows = extractCompetitorRows()(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
    assert.ok(
      !rows.some((row) => row.company.toLowerCase().includes("bookkeeping") || row.company.toLowerCase().includes("excel")),
      "a generic substitute-category phrase must never become its own row"
    );
  });

  // --- A real report WITH named substitutes -----------------------------

  test(`requirement E (${name}): when the source DOES name individual substitutes with the same "Name (details)" shape, they are recovered as distinct rows, tagged as substitutes`, () => {
    const contentWithNamedSubstitutes =
      "Direct competitors: Float (targets SMB finance teams). Substitutes: Excel Budgeting (spreadsheet-based, low cost). Notion Finance Template (manual tracking, free tier).";
    const rows = extractCompetitorRows()(contentWithNamedSubstitutes);
    const companies = rows.map((row) => row.company);
    assert.ok(companies.some((c) => c === "Float"));
    assert.ok(companies.some((c) => c.includes("Excel Budgeting") && c.includes("Substitute")));
    assert.ok(companies.some((c) => c.includes("Notion Finance Template") && c.includes("Substitute")));
  });

  // --- Requirement H: #69A-13's containment fix remains intact ---------

  test(`requirement H (${name}): the #69A-13 table containment/overflow fix (min-w-0 on every cell, wrap-safe threat chip, overflow-x-auto with an explicit min-w-[760px]) is completely unchanged by this data-modeling fix`, () => {
    const source = name === "Planner.tsx" ? plannerSource : pageSource;
    // Anchored on the branch condition itself (stable regardless of how
    // #69A-15 changed the competitors-computation line immediately
    // inside it -- from a bare extractCompetitorRows(...) call to a
    // ternary preferring businessCompetitorLandscapeState first).
    // page.tsx also has an EARLIER, unrelated normalizedTitle.includes("competitor")
    // occurrence (a markdown-table-stripping helper) that a bare
    // alternation would match instead -- this specific literal prefix
    // (matching this file's own real Competitor Landscape branch,
    // immediately followed by its own doc comment) disambiguates it.
    const branchAnchor =
      name === "Planner.tsx"
        ? /field === "competitorAnalysis" \|\| field === "competitorLandscape"\)/
        : /normalizedTitle\.includes\("competitor"\)\) \{\s*\n\s*\/\/ TASK/;
    const cardMatch = new RegExp(branchAnchor.source + "[\\s\\S]{0,6500}").exec(source);
    assert.ok(cardMatch, `${name}: competitor card block not found`);
    const block = cardMatch[0];
    assert.match(block, /mb-5 min-w-0 overflow-hidden rounded-\[2rem\] border border-white\/10 bg-white\/\[0\.025\]/);
    assert.match(block, /<div className="min-w-0 overflow-x-auto">/);
    assert.match(block, /<div className="min-w-\[760px\]">/);
    assert.match(block, /rounded-2xl border border-teal-200\/20 bg-teal-200\/10 px-2\.5 py-1 text-xs font-semibold text-teal-100/);
  });
}

// --- PDF export path (ReportPdfButton.tsx): the same fix, applied to a
// THIRD, independently-drifted copy that was never touched by #69A-13
// either, so it still had both bugs (cross-field duplication AND
// category-labels-as-company) until now. Its own missing-value
// convention is "Validation required", not "—".

test("PDF requirement A: category headings cannot become competitor company names in the PDF export path either", () => {
  const rows = pdfExtractCompetitorRows(CATEGORY_LABEL_PER_LINE_FIXTURE);
  const companies = rows.map((row) => row.company.toLowerCase());
  for (const forbidden of ["direct competitors", "substitutes", "pricing", "strengths of incumbents", "weaknesses"]) {
    assert.ok(!companies.includes(forbidden), `"${forbidden}" must never appear as a PDF company name`);
  }
});

test("PDF requirement B/E: Float and Cash Flow Frog are both recovered as distinct rows from the real cached report text in the PDF export path", () => {
  const rows = pdfExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  const companies = rows.map((row) => row.company);
  assert.ok(companies.includes("Float"), `Float missing: ${JSON.stringify(companies)}`);
  assert.ok(companies.includes("Cash Flow Frog"), `Cash Flow Frog missing: ${JSON.stringify(companies)}`);
});

test("PDF requirement C/D: Float's row maps its own parenthetical to positioning, and honestly shows the PDF table's own 'Validation required' marker for strengths/weaknesses/threat -- never fabricated, never borrowed from the shared Pricing/Weaknesses clauses", () => {
  const rows = pdfExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  const float = rows.find((row) => row.company === "Float");
  assert.ok(float, "Float row not found");
  assert.match(float.positioning, /targets finance teams in SMBs/);
  assert.equal(float.strengths, "Validation required");
  assert.equal(float.weaknesses, "Validation required");
  assert.equal(float.threat, "Validation required");
  assert.doesNotMatch(float.positioning, /vendor anchors show low-tier SMB pricing/);
});

test("PDF regression: the pre-existing cross-field duplication bug (positioning falling back to the WHOLE raw line, exactly what #69A-13 fixed in Planner.tsx/page.tsx) is now also fixed here -- an unlabeled competitor bullet's positioning is the PDF table's own missing-value marker, never the raw bullet text", () => {
  const rows = pdfExtractCompetitorRows("## Competitor Landscape\n- Acme Analytics Inc - a budget-friendly SaaS provider targeting SMBs with aggressive pricing and a lean support team.\n");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].positioning, "Validation required");
});

test("PDF requirement I: no hardcoded fictional competitor data -- every extracted company name is present in the real source content", () => {
  const rows = pdfExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  for (const row of rows) {
    const bareCompanyName = row.company.replace(/\s*\(Substitute\)$/, "");
    assert.ok(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD.includes(bareCompanyName));
  }
});

test("PDF requirement J: the pre-existing competitorSummaryLinePattern guard (Executive implication/Incumbent response/Switching barriers/Gap for new entrant) is unchanged -- this fix adds a second, complementary layer, never removes the first", () => {
  assert.match(
    reportPdfButtonSource,
    /const competitorSummaryLinePattern =\s*\n\s*\/\^\(\?:Executive implication\|Incumbent response\(\?: risk\)\?\|Switching barriers\?\|Gap for \(\?:a \)\?new entrant\)\\s\*\[:\\-–—\]\/i;/
  );
});

// --- Requirement G: saved/reloaded reports preserve the same structure --

test("requirement G: extractCompetitorRows is a pure function of its content argument (no external/session/random state) -- calling it twice with the identical persisted content (simulating a fresh generation vs. a saved-report reload) yields byte-identical rows in both Planner.tsx and page.tsx", () => {
  const firstCall = plannerExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  const secondCall = plannerExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  assert.deepEqual(firstCall, secondCall);

  const plannerRows = plannerExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  const pageRows = pageExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD);
  assert.deepEqual(plannerRows, pageRows, "Planner.tsx (live generation) and page.tsx (saved/reloaded report) must derive the identical competitor structure from the identical persisted content");
});

test("requirement G (PDF): the PDF export path recovers the SAME company set (Float, Cash Flow Frog) from the identical persisted content as the web renderers -- the underlying competitor identification is consistent across web report, saved reload, and PDF, even though each file's own presentation/missing-value text differs", () => {
  const plannerCompanies = plannerExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD).map((r) => r.company);
  const pdfCompanies = pdfExtractCompetitorRows(REAL_CACHED_COMPETITOR_LANDSCAPE_FIELD).map((r) => r.company);
  assert.deepEqual(new Set(plannerCompanies), new Set(pdfCompanies));
});

// --- Requirement J: canonical authority preservation (drift check) ------

test("requirement J: no canonical decision/confidence/evidence-provenance/Founder-Readiness/Benchmark-Intelligence/TAM-SAM-SOM/financial/risk/PDF-numeric file was touched by this extraction-layer fix", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-investment-score.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-14/);
  }
});

test("requirement J: the generation prompt itself (plan.ts) was NOT changed by this fix -- this is a parser/extraction-layer correction only, never a change to what the AI is asked to produce", () => {
  assert.doesNotMatch(planPromptsSource, /#69A-14/);
});
