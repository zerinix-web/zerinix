import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFinancialModel,
  extractUserStatedFinancials,
} from "../app/lib/ai/financial-model.ts";
import { formatCompetitorWeaknessForDisplay } from "../app/lib/report-engine/business-competitor-landscape-state.ts";

// TASK #69A-58 -- regression coverage for the BIV semantic-extraction and
// financial-integrity defects found in a fresh production PDF: target
// customer employee ranges leaking into founder team size, pricing unit/
// billing-period mixing, ARR/LTV display precision loss that made
// internally-consistent formulas look contradictory, and the competitor
// "unavailable" weakness wording.

// --- A. Target customer employee range must NOT become team size -------

test("target customer employee range ('SMBs with 10-200 employees') does not become team size", () => {
  const prompts = [
    "We are building FP&A software. Our target customer is SMBs with 10-200 employees.",
    "We target companies with 10 to 200 employees in the logistics space.",
    "We sell to businesses with 50-500 employees looking to automate payroll.",
    "Our ICP is organizations with 20-100 employees that lack a finance team.",
  ];

  for (const prompt of prompts) {
    const facts = extractUserStatedFinancials(prompt);
    assert.equal(
      facts.employees,
      null,
      `expected no team-size extraction from target-customer framing in: "${prompt}"`
    );
  }
});

// --- B. Genuine founder/company self-descriptions still extract --------

test("genuine founder/company self-description of team size still extracts", () => {
  assert.equal(
    extractUserStatedFinancials("Our startup has 12 employees today.").employees,
    12
  );
  assert.equal(
    extractUserStatedFinancials("We are a 15-person team building this product.").employees,
    15
  );
  assert.equal(
    extractUserStatedFinancials("We have a team of 8 engineers and designers.").employees,
    8
  );
});

// --- C. Monthly and annual pricing cannot silently interchange ----------

test("an annually-denominated price is never mistaken for a monthly price", () => {
  const facts = extractUserStatedFinancials(
    "We charge customers $24,000/year for the platform."
  );
  // extractUserStatedPricePerCustomer requires an explicit /month or /mo
  // token -- an annual figure must be left unextracted (falls back to the
  // benchmark ARPA assumption) rather than silently treated as a $24,000
  // monthly price.
  assert.equal(facts.pricePerCustomer, null);
});

test("an explicitly monthly price extracts as the exact monthly amount", () => {
  const facts = extractUserStatedFinancials(
    "Our subscription price is $500/month per customer."
  );
  assert.equal(facts.pricePerCustomer, 500);
});

// --- D. Per-seat and per-company pricing cannot silently interchange ----

test("a per-seat price is never folded into the per-company ARPA figure", () => {
  const facts = extractUserStatedFinancials(
    "We charge $50/seat/month for the product."
  );
  // There is no seat-based pricing unit in the canonical financial model --
  // a per-seat figure must not be captured as if it were the per-account
  // ARPA (which would silently understate/overstate revenue depending on
  // seat count). Left unextracted, the model falls back to the benchmark
  // per-account ARPA assumption instead of fabricating a per-seat concept.
  assert.equal(facts.pricePerCustomer, null);
});

// --- E. ARR (annualized run-rate) reconciles exactly with ending MRR ----

test("ARR is always exactly ending MRR times 12", () => {
  const model = createFinancialModel({
    prompt: "A B2B SaaS platform for logistics companies.",
    reportKind: "business_plan",
  });
  const { arr, mrr } = model.metrics;
  assert.ok(Number.isFinite(arr.value) && Number.isFinite(mrr.value));
  const relativeError = Math.abs(arr.value - mrr.value * 12) / Math.max(1, mrr.value * 12);
  assert.ok(
    relativeError < 1e-9,
    `expected ARR (${arr.value}) to equal MRR (${mrr.value}) x 12 exactly, relative error was ${relativeError}`
  );
});

test("ARR reconciles exactly with ending MRR even with a user-stated price and customer count", () => {
  const model = createFinancialModel({
    prompt:
      "A B2B SaaS platform. We charge $2,000/month subscription price and expect 48 customers by the end of year 1.",
    reportKind: "business_plan",
  });
  const { arr, mrr } = model.metrics;
  const relativeError = Math.abs(arr.value - mrr.value * 12) / Math.max(1, mrr.value * 12);
  assert.ok(relativeError < 1e-9);
  // With a user-stated price and customer count, the exact figures must be
  // traceable: 48 customers x $2,000/month x 12 = $1,152,000 ARR, not a
  // ramped or otherwise-adjusted figure silently substituted in.
  assert.equal(Math.round(mrr.value), 48 * 2000);
  assert.equal(Math.round(arr.value), 48 * 2000 * 12);
});

// --- F. Year-1 forecast revenue must never be a mislabeled ARR ----------

test("the Year 1 revenue-forecast row matches the canonical ARR metric exactly (never a separately-ramped figure silently relabeled as ARR)", () => {
  const model = createFinancialModel({
    prompt: "A B2B SaaS platform for logistics companies.",
    reportKind: "business_plan",
  });
  const yearOne = model.revenueForecast[0];
  assert.ok(yearOne, "expected a Year 1 revenue forecast row");
  const relativeError =
    Math.abs(yearOne.arr - model.metrics.arr.value) / Math.max(1, model.metrics.arr.value);
  assert.ok(
    relativeError < 1e-9,
    `Year 1 forecast ARR (${yearOne.arr}) must equal the canonical ARR metric (${model.metrics.arr.value}); a mismatch here would mean Year-1 revenue and ARR silently diverged`
  );
});

// --- G. LTV must be reproducible from its own canonical inputs ----------

test("LTV is exactly reproducible from ARPA x Gross Margin x the stated lifetime-months assumption", () => {
  const model = createFinancialModel({
    prompt: "A B2B SaaS platform for logistics companies.",
    reportKind: "business_plan",
  });
  const { ltv, arpa, grossMargin } = model.metrics;
  assert.match(ltv.formula, /Gross Margin/i);
  assert.match(ltv.formula, /lifetime months/i);

  const lifetimeAssumption = ltv.assumptions.find((line) => /^Lifetime:\s*\d+(\.\d+)?\s*months$/.test(line));
  assert.ok(lifetimeAssumption, `expected an explicit "Lifetime: N months" assumption, got: ${JSON.stringify(ltv.assumptions)}`);
  const lifetimeMonths = Number(lifetimeAssumption.match(/[\d.]+/)[0]);

  const expectedLtv = arpa.value * grossMargin.value * lifetimeMonths;
  const relativeError = Math.abs(ltv.value - expectedLtv) / Math.max(1, expectedLtv);
  assert.ok(
    relativeError < 1e-9,
    `LTV (${ltv.value}) must reproduce exactly from ARPA (${arpa.value}) x Gross Margin (${grossMargin.value}) x Lifetime (${lifetimeMonths} months) = ${expectedLtv}`
  );
});

// --- Display-precision fix: ARR/ARPA/LTV must not lose enough precision
// to make an internally-consistent formula look contradictory ----------

test("formatUsd keeps enough precision in the thousands range that ARPA x customers x 12 visibly reconciles with the displayed ARR", () => {
  const model = createFinancialModel({
    prompt:
      "A B2B SaaS platform. We charge $1,502/month subscription price and expect 48 customers by the end of year 1.",
    reportKind: "business_plan",
  });
  const { arpa, arr } = model.metrics;
  // Before the #69A-58 precision fix, formatUsd rounded any $1,000-$9,999
  // value to a bare integer "k" (Math.round(1502 / 1000) = 2 -> "$2k"),
  // discarding enough precision that a reader multiplying the displayed
  // figures (48 x $2,000 x 12 = $1,152,000) would see an apparent
  // contradiction with the displayed ARR (48 x $1,502 x 12 = $865,152 ->
  // "$865k"). One decimal place of precision keeps the displayed numbers
  // reconcilable: 48 x $1.5k x 12 ~= $865.2k.
  assert.equal(arpa.displayValue, "$1.5k/month");
  assert.equal(arr.displayValue, "$865.2k");
});

// --- H. Competitor "unavailable" weakness stays honest, not fabricated --

test("an unavailable competitor weakness renders an honest, professional label -- never a fabricated claim", () => {
  const display = formatCompetitorWeaknessForDisplay({
    weaknesses: "—",
    weaknessBasis: "unavailable",
  });
  assert.equal(display, "No evidence-backed weakness identified");
  // Must never silently become a directional/verified-sounding claim.
  assert.doesNotMatch(display, /\(Directional\)/);
});

// --- I. Verified/directional competitor weaknesses still render correctly

test("a directional competitor weakness still renders with its qualifier", () => {
  const display = formatCompetitorWeaknessForDisplay({
    weaknesses: "Limited embedded forecasting depth versus category leaders.",
    weaknessBasis: "directional",
  });
  assert.equal(display, "Limited embedded forecasting depth versus category leaders. (Directional)");
});

test("a verified competitor weakness renders with no qualifier appended", () => {
  const display = formatCompetitorWeaknessForDisplay({
    weaknesses: "No mobile app; desktop-only workflow confirmed on the vendor's own site.",
    weaknessBasis: "verified",
  });
  assert.equal(
    display,
    "No mobile app; desktop-only workflow confirmed on the vendor's own site."
  );
});

// --- J. Web and PDF must consume the identical canonical competitor state

test("web (dashboard, Planner) and PDF (ReportPdfButton) render competitor weaknesses through the same shared canonical function, never a local reimplementation", () => {
  const consumers = [
    "app/dashboard/[id]/page.tsx",
    "components/Planner.tsx",
    "app/dashboard/[id]/ReportPdfButton.tsx",
  ];

  for (const relativePath of consumers) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.match(
      source,
      /formatCompetitorWeaknessForDisplay/,
      `${relativePath} must render competitor weaknesses via the shared formatCompetitorWeaknessForDisplay helper`
    );
    // Guards against a future regression reintroducing a second,
    // independent "Not available" literal that would drift from the
    // canonical helper's own wording.
    assert.doesNotMatch(
      source,
      /weaknesses\s*:\s*["'`]Not available["'`]/,
      `${relativePath} must not hardcode its own "Not available" weakness literal`
    );
  }
});
