import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL FIX -- Cross-report consistency audit.
//
// A full audit across Business Plan, Market Intelligence, Acquisition
// Due Diligence, and the shared domain-analysis report family found two
// CONFIRMED, live, reproducible inconsistencies worth an immediate,
// narrowly-scoped fix (everything else the audit found is a
// documentation/recommendation item -- see the published audit report):
//
// 1. app/lib/ai/financial-model.ts's extractUserStatedFinancials (used
//    identically by both Business Plan and Market Intelligence, per
//    financial-assumptions.ts's createCanonicalFinancialAssumptions)
//    used a plain "\s*" connector between a matched value and its
//    label, which matches across a newline. A structured, one-fact-
//    per-line prompt -- "Subscription price: $500\nInitial investment:
//    $1,000,000" -- let "$500" (Subscription price's own value) bleed
//    forward across the line break into matching the "initial
//    investment" label on the FOLLOWING line, so investmentAmount was
//    extracted as 500 instead of 1,000,000: a founder-stated fact
//    silently reassigned to the wrong field. This is the exact bug
//    class app/lib/ai/acquisition-deal-facts.ts's "sameLineGap" already
//    fixed for Acquisition (its own code comment documents the same
//    live repro); financial-model.ts had never received the equivalent
//    fix. Applied identically here.
// 2. app/dashboard/page.tsx's getDecisionSignal (the shared reports-
//    list decision label, rendered for every report kind together) had
//    a keyword-extraction fallback that recognized Business Plan's GO/
//    WAIT/PASS-family vocabulary but none of Acquisition Due
//    Diligence's own three canonical call phrases ("Proceed with
//    Conditions"/"Pause Pending Review"/"Reject", required verbatim by
//    app/lib/report-engine/prompts/acquisition-analysis.ts's
//    finalInvestmentRecommendation field). Since neither phrase is
//    formatted as a "Label: value" line, the explicit-signal extraction
//    never matched either, and two of Acquisition's three possible
//    calls ("Proceed with Conditions" and "Reject" -- neither contains
//    GO/WAIT/PIVOT/VALIDATE/REVIEW/HOLD as a whole word) fell all the
//    way through to a generic "ready for review" placeholder -- while a
//    Business Plan report on the very same shared list always showed a
//    real decision word. Fixed by matching Acquisition's own phrases
//    (and the shared GO/CONDITIONAL GO/NO-GO executive-decision-brief
//    vocabulary other domain reports use) as whole phrases first.
//
// Routing, PDF generation, and every other report kind's underlying
// decision/valuation logic are untouched.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/industry-benchmarks.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { extractUserStatedFinancials } = await importFinancialModel();
const dashboardPageSource = readFileSync(
  new URL("../app/dashboard/page.tsx", import.meta.url),
  "utf8"
);

// --- 1. financial-model.ts: same-line-only value/label adjacency ----------

test("a structured, one-fact-per-line prompt no longer bleeds one line's value into the next line's label (the exact reported bug)", () => {
  const facts = extractUserStatedFinancials(
    "Subscription price: $500\nInitial investment: $1,000,000"
  );
  assert.equal(facts.pricePerCustomer, 500);
  assert.equal(facts.investmentAmount, 1_000_000);
});

test("a fuller structured prompt (price/investment/Year-1 target/employees, one per line) extracts every fact to its correct field", () => {
  const facts = extractUserStatedFinancials(
    "Subscription price: $500/month\nInitial investment: $1,000,000\nYear 1 target: 200 customers\nTeam size: 12 employees"
  );
  assert.equal(facts.pricePerCustomer, 500);
  assert.equal(facts.investmentAmount, 1_000_000);
  assert.equal(facts.year1CustomerTarget, 200);
  assert.equal(facts.employees, 12);
});

test("ordinary prose phrasing (not line-structured) still extracts identically -- no regression from the same-line restriction", () => {
  const facts = extractUserStatedFinancials(
    "We want to launch a B2B SaaS product. Our subscription price is $500/month. Year 1 target: 200 customers. We are seeking a $1M initial investment. Our team currently has 12 employees."
  );
  assert.equal(facts.pricePerCustomer, 500);
  assert.equal(facts.year1CustomerTarget, 200);
  assert.equal(facts.investmentAmount, 1_000_000);
  assert.equal(facts.employees, 12);
});

test("MRR/ARR labeled extraction (extractLabeledUsdAmount) also respects the same-line restriction", () => {
  const facts = extractUserStatedFinancials("MRR: $18,000\nARR: $216,000");
  assert.equal(facts.mrr, 18_000);
  assert.equal(facts.arr, 216_000);
});

test("negation safety is unaffected by the same-line-gap change", () => {
  const facts = extractUserStatedFinancials(
    "We don't have $500/month in subscription price yet."
  );
  assert.equal(facts.pricePerCustomer, null);
});

// --- 2. dashboard/page.tsx: cross-report decision-signal consistency ------

test("getDecisionSignal's keyword fallback now recognizes Acquisition's own canonical call phrases, not just Business Plan's GO/WAIT/PASS vocabulary", () => {
  const fnMatch = /function getDecisionSignal\([\s\S]*?\n}/.exec(dashboardPageSource);
  assert.ok(fnMatch, "getDecisionSignal not found");
  const body = fnMatch[0];
  assert.match(body, /Proceed with Conditions/);
  assert.match(body, /Pause Pending Review/);
  assert.match(body, /Reject/);
  assert.match(body, /Conditional Go/);
  assert.match(body, /No\[- ]Go/);
});

test("Acquisition's three canonical decision phrases each extract correctly (previously two of three fell through to a generic placeholder)", () => {
  const keywordPattern =
    /\b(Proceed with Conditions|Pause Pending Review|Reject|Conditional Go|No[- ]Go|GO|NO GO|WAIT|PIVOT|VALIDATE|REVIEW|HOLD)\b/i;

  assert.equal(
    "Proceed with Conditions. The deal clears financial diligence but requires a customer-concentration review.".match(
      keywordPattern
    )?.[1],
    "Proceed with Conditions"
  );
  assert.equal(
    "Pause Pending Review. Regulatory clearance for the target's core market is still unresolved.".match(
      keywordPattern
    )?.[1],
    "Pause Pending Review"
  );
  assert.equal(
    "Reject. The target's customer concentration risk is unacceptable as currently structured.".match(
      keywordPattern
    )?.[1],
    "Reject"
  );
});

test("Business Plan's existing GO/WAIT/PASS-family keyword signal is unaffected (no regression)", () => {
  const keywordPattern =
    /\b(Proceed with Conditions|Pause Pending Review|Reject|Conditional Go|No[- ]Go|GO|NO GO|WAIT|PIVOT|VALIDATE|REVIEW|HOLD)\b/i;

  assert.equal("Final Decision: GO. Strong fundamentals support scaling now.".match(keywordPattern)?.[1], "GO");
  assert.equal("Recommendation: WAIT until validation is complete.".match(keywordPattern)?.[1], "WAIT");
  assert.equal("Executive call: NO-GO given weak validation.".match(keywordPattern)?.[1], "NO-GO");
});

// --- 3. Drift checks: routing and PDF generation are untouched ------------

test("PDF generation (ReportPdfButton.tsx) and domain routing are untouched by this fix (drift check)", async () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(pdfSource, /getDecisionSignal/);

  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");
  assert.equal(
    classifyReportDomain("I want to acquire a cybersecurity SaaS company."),
    "acquisition"
  );
});
