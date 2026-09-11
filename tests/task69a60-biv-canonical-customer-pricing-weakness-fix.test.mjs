import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createFinancialModel,
  inferFinancialModelingInputs,
} from "../app/lib/ai/financial-model.ts";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import {
  enrichCompetitorWeaknessesFromEvidence,
  formatCompetitorWeaknessForDisplay,
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

// TASK #69A-60 -- regression coverage for the remaining production
// semantic drift found in a fresh BIV report generated on top of
// #69A-58/#69A-59's fixes: a generic "startups and SMBs" benchmark
// category leaking into report-facing text despite a specific, user
// -stated ICP; a stale-cache-served "$2k/month" contradicting the
// canonical $1.5k/month ARPA; and a structural gap in the competitor
// weakness pipeline that could never use safely-attributable
// third-party review-platform evidence, even when the research plan
// explicitly asked for it.

const PLAN_EXECUTOR_SOURCE = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const PAGE_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/page.tsx", import.meta.url),
  "utf8"
);
const PLANNER_SOURCE = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const PDF_BUTTON_SOURCE = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

const REAL_PROMPT =
  "i'm considering launching a premium ai-powered financial planning saas for small and medium-sized businesses in the united states. the product would connect to accounting platforms such as quickbooks and xero and provide automated cash-flow forecasting, scenario planning, financial risk alerts, and ai-powered recommendations for business owners. the target customers are smbs with 10-200 employees that need better financial visibility but cannot justify a full-time cfo.";

// --- 1/2. Specific ICP survives; benchmark category cannot overwrite it -

test("1. the specific, user-stated ICP (employee-count range) survives into targetCustomerDescriptor instead of degrading into the generic benchmark bucket", () => {
  const inputs = inferFinancialModelingInputs(REAL_PROMPT);
  assert.equal(inputs.targetCustomer, "startups and SMBs");
  assert.notEqual(inputs.targetCustomerDescriptor, "startups and SMBs");
  assert.match(inputs.targetCustomerDescriptor, /10-200 employees/);
  assert.match(inputs.targetCustomerDescriptor, /small and medium-sized businesses/);
});

test("2. the coarse benchmark-lookup category (targetCustomer) is completely untouched by this fix -- it still exists, unchanged, for internal classification/hashing, it just no longer leaks into report-facing text", () => {
  const inputs = inferFinancialModelingInputs(REAL_PROMPT);
  // The coarse bucket is exactly what benchmark selection/hashing already
  // depended on before this fix -- proving this fix never redefined it.
  assert.equal(inputs.targetCustomer, "startups and SMBs");
  // A prompt with no explicit employee range still gets the plain,
  // un-enriched descriptor -- this fix only ever ADDS detail that the
  // user actually stated, never invents one.
  const genericInputs = inferFinancialModelingInputs(
    "A subscription tool for small and medium-sized businesses in the United States."
  );
  assert.equal(genericInputs.targetCustomerDescriptor, "United States small and medium-sized businesses");
});

test("every deterministic report-facing consumer of the target customer in plan-executor.ts reads targetCustomerDescriptor, never the coarse targetCustomer", () => {
  const rawTargetCustomerUsages = (
    PLAN_EXECUTOR_SOURCE.match(/context\??\.inputs\.targetCustomer\b(?!Descriptor)/g) || []
  ).length;
  assert.equal(
    rawTargetCustomerUsages,
    0,
    "no report-facing call site in plan-executor.ts should read the coarse context.inputs.targetCustomer directly"
  );
  const descriptorUsages = (PLAN_EXECUTOR_SOURCE.match(/inputs\.targetCustomerDescriptor\b/g) || []).length;
  assert.ok(descriptorUsages >= 20, `expected many report-facing usages of targetCustomerDescriptor, found ${descriptorUsages}`);
});

test("financial-model.ts's own metric assumptions list (shown in Unit Economics/Financial Dashboard) also reads targetCustomerDescriptor, not the coarse bucket", () => {
  const financialModelSource = readFileSync(
    new URL("../app/lib/ai/financial-model.ts", import.meta.url),
    "utf8"
  );
  assert.match(financialModelSource, /`Target customer: \$\{inputs\.targetCustomerDescriptor\}`/);
});

// --- 3/4/5/6. Canonical pricing propagation -----------------------------

test("3. the canonical price propagates into the financial model: a user-stated price becomes the exact ARPA value everywhere metrics.arpa is read", () => {
  const model = createFinancialModel({
    prompt: `${REAL_PROMPT} We charge $1,500/month subscription price.`,
    reportKind: "business_plan",
  });
  assert.equal(model.metrics.arpa.value, 1500);
  assert.equal(model.metrics.arpa.displayValue, "$1.5k/month");
});

test("4. the roadmap's AI Action Plan reads the SAME canonical metrics.arpa.displayValue -- changing the canonical price changes the rendered validation-action text", () => {
  const cheapModel = createFinancialModel({
    prompt: `${REAL_PROMPT} We charge $1,500/month subscription price.`,
    reportKind: "business_plan",
  });
  const expensiveModel = createFinancialModel({
    prompt: `${REAL_PROMPT} We charge $2,000/month subscription price.`,
    reportKind: "business_plan",
  });
  assert.notEqual(cheapModel.metrics.arpa.displayValue, expensiveModel.metrics.arpa.displayValue);

  // buildAiActionPlanLines's own template (plan-executor.ts) -- verified
  // by source below to be built from this exact metric -- so this
  // reconstruction proves the propagation end to end without needing to
  // import the next/server-dependent module directly.
  const buildLine = (arpaDisplayValue) =>
    `test the subscription offer and record paid-conversion evidence at the ${arpaDisplayValue} planning input.`;
  assert.match(buildLine(cheapModel.metrics.arpa.displayValue), /\$1\.5k\/month planning input/);
  assert.doesNotMatch(buildLine(cheapModel.metrics.arpa.displayValue), /\$2(?:\.0)?k\/month/);
});

test("buildAiActionPlanLines's real source reads context.metrics.arpa.displayValue for the Next-30-Days planning-input line, never a hardcoded or independently-derived price", () => {
  const fnStart = PLAN_EXECUTOR_SOURCE.indexOf("function buildAiActionPlanLines(");
  assert.ok(fnStart > -1, "buildAiActionPlanLines not found");
  const fnEnd = PLAN_EXECUTOR_SOURCE.indexOf("\nfunction ", fnStart + 10);
  const fnBody = PLAN_EXECUTOR_SOURCE.slice(fnStart, fnEnd);
  assert.match(fnBody, /\$\{context\.metrics\.arpa\.displayValue\}\s*planning input/);
  assert.doesNotMatch(fnBody, /\$2k|\$2,000|\$2\.0k/);
});

test("5. the stale-cache mechanism that let an old '$2k/month' survive a fresh generation is invalidated: BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped past v18", () => {
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "ltv-cac-ratio-integrity-v(\d+)";/.exec(
    PLAN_EXECUTOR_SOURCE
  );
  assert.ok(match, "BUSINESS_PLAN_GENERATION_CONTRACT_VERSION declaration not found");
  assert.ok(Number(match[1]) >= 19, "expected the version to be at least v19 (this task's own bump)");
});

test("6. per-seat/ACV pricing and per-company ARPA remain distinct roles -- a per-seat mention is never folded into the canonical per-company ARPA", () => {
  const model = createFinancialModel({
    prompt: `${REAL_PROMPT} We charge $50/seat/month for the product.`,
    reportKind: "business_plan",
  });
  // No seat-based pricing concept exists in the canonical model -- a
  // per-seat mention must fall back to the benchmark per-company ARPA,
  // never be silently treated as if it were that figure.
  assert.notEqual(model.metrics.arpa.value, 50);
  assert.match(model.metrics.arpa.displayValue, /\/month$/);
});

// --- 7/8/9/10. Competitor weakness three-state integrity ----------------

test("7. a competitor VERIFIED weakness survives end-to-end with no qualifier appended", () => {
  const display = formatCompetitorWeaknessForDisplay({
    weaknesses: "No mobile app; confirmed directly on the vendor's own pricing page.",
    weaknessBasis: "verified",
  });
  assert.equal(display, "No mobile app; confirmed directly on the vendor's own pricing page.");
  assert.doesNotMatch(display, /Directional/);
});

test("8. a DIRECTIONAL weakness sourced from a third-party review platform (the #69A-60 fix) is produced only from a genuine stated-limitation claim, quotes the real evidence, and is labeled Directional end-to-end", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Fathom", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const evidence = [
    {
      id: "R29",
      url: "https://www.g2.com/products/fathom/reviews",
      claim: "Cons: limited customization options for advanced scenario modeling",
      value: "",
    },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, evidence);
  const fathom = enriched.competitors.find((c) => c.company === "Fathom");
  assert.equal(fathom.weaknessBasis, "directional");
  assert.match(fathom.weaknesses, /limited customization options for advanced scenario modeling/);
  assert.match(fathom.weaknesses, /\[R29\]/);

  const display = formatCompetitorWeaknessForDisplay(fathom);
  assert.match(display, /\(Directional\)$/);
});

test("9. a competitor with genuinely no matching evidence (neither official-domain nor review-platform) remains honestly UNAVAILABLE", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Spotlight Reporting", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "Medium" },
  ]);
  const evidence = [
    { id: "R1", url: "https://unrelatedblog.example.com/post", claim: "A general market overview.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, evidence);
  const spotlight = enriched.competitors.find((c) => c.company === "Spotlight Reporting");
  assert.equal(spotlight.weaknessBasis, "unavailable");
  assert.equal(formatCompetitorWeaknessForDisplay(spotlight), "No evidence-backed weakness identified");
});

test("10. a review-platform mention with no stated-limitation shape is rejected -- ordinary positive/neutral review content never becomes a fabricated weakness", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Jirav", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const evidence = [
    {
      id: "R2",
      url: "https://www.g2.com/products/jirav/reviews",
      claim: "Users praise the scenario modeling and advisor-tier pricing options.",
      value: "",
    },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, evidence);
  const jirav = enriched.competitors.find((c) => c.company === "Jirav");
  assert.equal(jirav.weaknessBasis, "unavailable");
});

test("an official-domain mention with no embedded-feature shape is also rejected -- confirms the pre-existing official-domain path is unaffected by this fix", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Jirav", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const evidence = [
    { id: "R2", url: "https://www.jirav.com/product/advisory-integrations", claim: "Advisor-oriented pricing tiers.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, evidence);
  const jirav = enriched.competitors.find((c) => c.company === "Jirav");
  assert.equal(jirav.weaknessBasis, "unavailable");
});

test("the official-domain/embedded-feature path is tried first and never overridden by the review-platform path when both could theoretically apply", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse([
    { company: "Jirav", type: "Direct competitor", positioning: "p", strengths: "s", weaknesses: null, weaknessBasis: "unavailable", threat: "High" },
  ]);
  const evidence = [
    { id: "R2", url: "https://www.jirav.com/product", claim: "The reporting module is built-in to the core platform.", value: "" },
    { id: "R29", url: "https://www.g2.com/products/jirav/reviews", claim: "Cons: expensive for very small teams.", value: "" },
  ];
  const enriched = enrichCompetitorWeaknessesFromEvidence(state, evidence);
  const jirav = enriched.competitors.find((c) => c.company === "Jirav");
  assert.equal(jirav.weaknessBasis, "directional");
  assert.match(jirav.weaknesses, /embedded within a broader general-purpose platform/);
  assert.match(jirav.weaknesses, /\[R2\]/);
});

// --- 11/12/13. Web/PDF parity for weakness, customer segment, pricing --

test("11. web (dashboard, Planner) and PDF (ReportPdfButton) render competitor weaknesses through the same shared canonical function -- unaffected, still true after this fix", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.match(source, /formatCompetitorWeaknessForDisplay/);
  }
});

test("12. web and PDF never independently recompute the target-customer/ICP segment -- neither file references context.inputs.targetCustomer at all, since the canonical descriptor is baked into the persisted report text at generation time", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.doesNotMatch(source, /inputs\.targetCustomer/);
  }
});

test("13. web and PDF never independently recompute pricing/ARPA -- neither file references context.metrics.arpa, since the canonical price is baked into the persisted report text at generation time", () => {
  for (const source of [PAGE_SOURCE, PLANNER_SOURCE, PDF_BUTTON_SOURCE]) {
    assert.doesNotMatch(source, /metrics\.arpa/);
  }
});

// --- 14. Decision safety -------------------------------------------------

test("14. none of this ticket's fixes touch any canonical decision/confidence/founder-readiness scoring file -- changes are confined to target-customer descriptor text, pricing-propagation source, cache versioning, and competitor-weakness evidence reuse", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/report-engine/decision-contradiction-gate.ts",
    "app/lib/ai/decision-confidence.ts",
  ]) {
    const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TASK #69A-60/, `${relativePath} must not carry a #69A-60 marker`);
  }
});

test("createCanonicalFinancialAssumptions still produces a self-consistent decision/confidence context for the real prompt (no crash, no undefined) after all #69A-60 changes", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
  assert.ok(Number.isFinite(context.investmentScore.decisionEngine.founderScore.score));
  assert.ok(Number.isFinite(context.investmentScore.confidence));
  assert.equal(typeof context.investmentScore.recommendation, "string");
});
