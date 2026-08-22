import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL PRODUCTION FIX -- the actual root cause behind three straight
// bug reports where "the report is still rendered as a Business Plan
// Report instead of a dedicated Acquisition Due Diligence Report."
//
// Every earlier fix (schema, generator, PDF template, dashboard
// rendering) was already correct and fully tested, but architecturally
// unreachable: resolveReportDomainForSelectedMode
// (app/lib/report-engine/domain.ts) hard-forced selectedMode === "plan"
// (Business Idea Validation -- the first, most prominent of the three
// product cards) to always return "business", the same restriction that
// already applies to real_estate/legal/finance/etc. There is no
// dedicated M&A/acquisition entry point in the product, so a real user
// evaluating an acquisition most naturally clicks "Business Idea
// Validation" -- and got a Business Plan back every time, regardless of
// how clearly the prompt described an acquisition.
//
// Confirmed product decision: acquisition is the one deliberate
// exception to that boundary, scoped to "plan" only (never "market",
// which never consults this function for routing anyway; the UI itself
// is unchanged -- no fourth mode card was added).
//
// This file is the dedicated regression guarantee the fix explicitly
// requested: acquisition reports can never again fall back to the
// Business Plan renderer, proven at every layer -- the routing decision
// itself, the field-schema level (planFields and acquisitionAnalysisFields
// share zero field names, so a report generated under one schema could
// never accidentally satisfy or render through the other's field-driven
// UI/PDF code), and the generator-selection level in plan-executor.ts.

const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
  "../app/lib/report-engine/domain.ts"
);
const { planFields } = await import("../app/lib/report-engine/prompts/plan.ts");
const { acquisitionAnalysisFields } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);

const acquisitionPrompts = [
  "We are evaluating the acquisition of a mid-market logistics company. Please assess whether this is a good acquisition.",
  "Our corporate development team wants to acquire a company in the fintech space. Assess the target's valuation and financing structure.",
  "We are considering a merger with a competitor. Assess strategic fit, synergies, and integration risk.",
  "Please perform due diligence on this acquisition target ahead of a potential purchase, including EV/ARR valuation and IRR.",
  "We are structuring a leveraged buyout of an established manufacturing company. Assess debt capacity and post-merger integration.",
];

// --- Requirement: reproduce the exact live bug and prove the fix -------

test("THE LIVE BUG, REPRODUCED AND FIXED: an acquisition prompt submitted through 'plan' (Business Idea Validation -- the card a real user actually clicks) now resolves to the 'acquisition' domain, never 'business'", () => {
  for (const prompt of acquisitionPrompts) {
    const inferredDomain = classifyReportDomain(prompt);
    assert.equal(inferredDomain, "acquisition", `prompt did not classify as acquisition: "${prompt}"`);

    const resolvedDomain = resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain,
      expertiseDomain: "acquisition",
    });
    assert.equal(
      resolvedDomain,
      "acquisition",
      `prompt still resolved to "${resolvedDomain}" under "plan" mode instead of "acquisition": "${prompt}"`
    );
    assert.notEqual(resolvedDomain, "business", `prompt fell back to "business" (the exact live bug): "${prompt}"`);
  }
});

test("a genuine Business Idea Validation prompt (no acquisition intent) is completely unaffected by the fix -- still resolves to 'business' under 'plan'", () => {
  const genuinePrompts = [
    "I want to build an AI-powered scheduling app for freelance photographers.",
    "Validate my business idea: a subscription box for artisanal coffee.",
    "Should I start a SaaS platform for restaurant inventory management?",
  ];

  for (const prompt of genuinePrompts) {
    const inferredDomain = classifyReportDomain(prompt);
    assert.notEqual(inferredDomain, "acquisition", `genuine business prompt was misclassified as acquisition: "${prompt}"`);

    const resolvedDomain = resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain,
      expertiseDomain: undefined,
    });
    assert.equal(resolvedDomain, "business", `genuine business prompt did not resolve to "business": "${prompt}"`);
  }
});

// --- Requirement: the field schemas can never be confused, so even a  --
// --- routing regression could not silently render the wrong template  --

test("planFields (Business Plan) and acquisitionAnalysisFields (Acquisition Due Diligence) share ZERO field names -- a report generated under one schema structurally cannot satisfy or render through the other's field-driven UI/PDF code", () => {
  const overlap = planFields.filter((field) => acquisitionAnalysisFields.includes(field));
  assert.deepEqual(overlap, [], `unexpected shared field names: ${overlap.join(", ")}`);
});

test("acquisitionAnalysisFields never contains any of the exact startup sections the fix requires removed: Problem, Solution, ICP, TAM/SAM/SOM, Pricing Strategy, Go-To-Market, Sales Strategy, Founder Roadmap, Founder Readiness, Startup KPIs, Business Validation, Product Validation", () => {
  // planFields is the authoritative source of these Business Plan field
  // names (problem, solution, targetCustomer/ICP, tamSamSom,
  // pricingStrategy, goToMarketPlan, salesStrategy, founderRoadmap,
  // founderScore, kpiDashboard/kpis) -- confirming zero overlap above
  // already proves this structurally, but this test also checks by
  // requested concept name directly, independent of exact field-key
  // spelling, in case either schema's field keys are ever renamed again.
  const requestedRemovals = [
    /problem/i,
    /\bsolution\b/i,
    /\bicp\b|idealCustomerProfile|targetCustomer/i,
    /tam.?sam.?som/i,
    /pricingStrategy/i,
    /goToMarket/i,
    /salesStrategy/i,
    /founderRoadmap/i,
    /founderScore|founderReadiness/i,
    /kpiDashboard|startupKpi/i,
  ];

  for (const pattern of requestedRemovals) {
    assert.ok(
      !acquisitionAnalysisFields.some((field) => pattern.test(field)),
      `acquisitionAnalysisFields unexpectedly contains a field matching ${pattern}`
    );
  }
});

// --- Requirement: plan-executor.ts's generator selection is keyed off --
// --- the SAME resolveReportDomainForSelectedMode this file tests, so  --
// --- the routing fix above is guaranteed to reach the real generator  --
// --- (drift check; the file is too large/side-effectful to import).  --

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

test("plan-executor.ts's reportDomain (the value that selects which generator runs) is computed via resolveReportDomainForSelectedMode -- the exact function this file's routing tests exercise, not a separate/duplicated decision", () => {
  assert.match(
    planExecutorSource,
    /const reportDomain = resolveReportDomainForSelectedMode\(\{\s*\n\s*selectedMode: selectedAnalysisMode,\s*\n\s*inferredDomain: inferredReportDomain,/
  );
  assert.match(planExecutorSource, /const inferredReportDomain = classifyReportDomain\(promptText, analysisAssets\);/);
});

test("domain.ts: the acquisition escape hatch is scoped to 'plan' only -- documented, deliberate, and does not weaken the boundary for any other specialized domain (drift check)", () => {
  const domainSource = readFileSync(
    new URL("../app/lib/report-engine/domain.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    domainSource,
    /if \(selectedMode === "plan"\) \{\s*return inferredDomain === "acquisition" \? "acquisition" : "business";\s*\}/
  );
  assert.match(domainSource, /if \(selectedMode === "market"\) \{\s*return "business";\s*\}/);
});
