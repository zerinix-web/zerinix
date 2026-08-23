import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL BUG FIX -- Business Plan prompts were incorrectly routed to
// Acquisition Due Diligence reports.
//
// Reported: "I want to launch a B2B AI cybersecurity platform for small
// and medium-sized businesses in Europe..." (a Business Idea Validation
// prompt) was classified as an Acquisition Due Diligence report instead
// of a Business Plan.
//
// Root cause, found by testing classifyReportDomain (app/lib/report-engine/
// domain.ts) directly against the reported prompt and its natural
// continuations: acquisitionSignals included bare "financing structure"
// and "debt financing" as standalone triggers -- both are ordinary
// startup-pitch capital-planning vocabulary (any pre-revenue venture
// describes its own financing structure), not unambiguous M&A signals,
// so a Business Plan prompt that went on to mention its own funding plans
// tripped the acquisition classifier.
//
// A second, opposite bug was found in the same audit: "acquire a
// cybersecurity SaaS company" -- an entirely ordinary way to state
// acquisition intent -- did NOT match the "acquire ... company" pattern
// at all, because it required the company-type noun to sit immediately
// after "a"/"the" with zero descriptive words in between. Both are fixed
// here: the two generic financing phrases are removed as standalone
// triggers, and "acquire"/"buy"/"purchase a [company]" now tolerate
// descriptive words between the article and the noun.
//
// No report generation, sanitization, or presentation-layer code was
// touched -- this is purely a fix to report type inference (domain.ts).

const domainSource = readFileSync(
  new URL("../app/lib/report-engine/domain.ts", import.meta.url),
  "utf8"
);

const { classifyReportDomain, resolveReportDomainForSelectedMode } = await import(
  "../app/lib/report-engine/domain.ts"
);

// --- 1. The exact reported bug, reproduced end to end ----------------------

test("the exact reported prompt ('I want to launch a B2B AI cybersecurity platform...') classifies as business, not acquisition", () => {
  const prompt =
    "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe.";
  assert.equal(classifyReportDomain(prompt), "business");
});

test("the same prompt, extended with the natural continuation that actually triggered the bug (mentioning its own financing structure/debt financing), still classifies as business", () => {
  const prompt =
    "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe. Our financing structure includes $2M in seed funding and some debt financing.";
  assert.equal(classifyReportDomain(prompt), "business");
});

test("the exact acquisition example from the ticket ('I want to acquire a cybersecurity SaaS company...') classifies as acquisition", () => {
  const prompt = "I want to acquire a cybersecurity SaaS company for $40M.";
  assert.equal(classifyReportDomain(prompt), "acquisition");
});

// --- 2. Acquisition should ONLY trigger for genuine acquisition intent -----

const acquisitionIntentPrompts = [
  ["acquire", "I want to acquire a cybersecurity SaaS company."],
  ["buy", "We are looking to buy a small manufacturing business."],
  ["purchase", "We want to purchase an established e-commerce company."],
  ["merge", "Our company is exploring a merger with a competitor."],
  ["M&A", "We are conducting M&A due diligence on a potential target."],
  [
    "target company acquisition",
    "Should we pursue a corporate acquisition of this target company?",
  ],
  [
    "due diligence of an existing company",
    "We need due diligence of an existing company before closing.",
  ],
];

for (const [label, prompt] of acquisitionIntentPrompts) {
  test(`acquisition intent "${label}" correctly classifies as acquisition: ${JSON.stringify(prompt)}`, () => {
    assert.equal(classifyReportDomain(prompt), "acquisition");
  });
}

// --- 3. Acquisition must NEVER trigger for these -----------------------------

const nonAcquisitionPrompts = [
  ["AI cybersecurity platform", "We are building an AI cybersecurity platform for enterprises."],
  ["SaaS startup", "I want to build a SaaS startup for project management."],
  ["launch", "We're launching a new fintech app for freelancers."],
  ["build", "I want to build a marketplace platform for local artisans."],
  ["create", "We want to create a new subscription product for pet owners."],
  ["new product", "We are designing a new product line for our existing customers."],
  ["business idea", "I have a business idea for a subscription meal-kit service."],
];

for (const [label, prompt] of nonAcquisitionPrompts) {
  test(`"${label}" never triggers acquisition classification: ${JSON.stringify(prompt)}`, () => {
    assert.notEqual(classifyReportDomain(prompt), "acquisition");
  });
}

// --- 4. The specific regex bugs, isolated -----------------------------------

test("'financing structure' and 'debt financing' are no longer standalone acquisition triggers", () => {
  assert.equal(classifyReportDomain("Our financing structure needs work."), "business");
  assert.equal(
    classifyReportDomain("We are seeking debt financing to expand our SaaS platform."),
    "business"
  );
});

test("'acquire a [descriptive words] company' matches even with several descriptive words between the article and the noun (the exact gap that let a genuine acquisition prompt slip through unclassified)", () => {
  assert.equal(
    classifyReportDomain(
      "We want to acquire a well-established, profitable AI-powered cybersecurity SaaS company."
    ),
    "acquisition"
  );
});

test("bare 'buy'/'purchase' without a company-type noun never triggers acquisition (ordinary e-commerce/pricing vocabulary stays safe)", () => {
  assert.notEqual(
    classifyReportDomain("Customers can buy our product directly from the app."),
    "acquisition"
  );
  assert.notEqual(
    classifyReportDomain("Users purchase a monthly subscription to access premium features."),
    "acquisition"
  );
});

// --- 5. Preserve acquisition improvements -----------------------------------

test("resolveReportDomainForSelectedMode still routes 'plan' mode to acquisition when the domain is correctly inferred as acquisition (the acquisition product entry point is unchanged)", () => {
  const inferredDomain = classifyReportDomain("I want to acquire a cybersecurity SaaS company for $40M.");
  assert.equal(inferredDomain, "acquisition");
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain,
      expertiseDomain: "acquisition",
    }),
    "acquisition"
  );
});

test("resolveReportDomainForSelectedMode still routes 'plan' mode to business for the reported bug's prompt (no longer defaults to acquisition)", () => {
  const inferredDomain = classifyReportDomain(
    "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe."
  );
  assert.equal(inferredDomain, "business");
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "plan",
      inferredDomain,
      expertiseDomain: undefined,
    }),
    "business"
  );
});

test("the acquisition-specific deal-fact extraction, fallback content generators, and AI prompts are untouched by this routing-only fix (drift check)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const { acquisitionAnalysisPrompts, acquisitionAnalysisFields } = await import(
    "../app/lib/report-engine/prompts/acquisition-analysis.ts"
  );

  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(acquisitionAnalysisFields.length, 20);
  assert.match(
    acquisitionAnalysisPrompts.finalInvestmentRecommendation,
    /Proceed with Conditions, Pause Pending Review, or Reject/
  );
});

test("report-presentation-sanitizer.ts and buildExecutiveSnapshot's decision-card logic are untouched by this routing-only fix (drift check)", async () => {
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  assert.equal(typeof stripReportPresentationArtifacts, "function");

  const presentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(presentationSource, /Proceed with Conditions\|Pause Pending Review/);
});

// --- 6. Structural drift check on the fix itself ----------------------------

test("acquisitionSignals no longer contains 'financing structure' or 'debt financing' as standalone alternatives (drift check)", () => {
  const signalsMatch = /const acquisitionSignals = new RegExp\(([\s\S]*?)\);/.exec(domainSource);
  assert.ok(signalsMatch, "acquisitionSignals definition not found");
  assert.doesNotMatch(signalsMatch[1], /financing structure/);
  assert.doesNotMatch(signalsMatch[1], /debt financing/);
});
