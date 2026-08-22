import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL ACQUISITION CONTENT FIX -- regression suite for the explicit
// requirement list: verified deal-fact extraction, EV/ARR calculation,
// financing split, rejection of irrelevant sources, non-empty acquisition
// sections, and no generic "See X" placeholder fallbacks.

const {
  extractAcquisitionDealFacts,
  computeAcquisitionDerivedMetrics,
  formatVerifiedDealFactsBlock,
  formatDerivedValuationBlock,
  formatDerivedFinancingBlock,
} = await import("../app/lib/ai/acquisition-deal-facts.ts");

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const acquisitionAnalysisSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
  "utf8"
);

// The exact scenario from the fix request.
const scenarioPrompt =
  "We are acquiring a cybersecurity SaaS company in Germany. Purchase price is $14M. " +
  "Target ARR is $2.8M. It has 150 enterprise customers and 18 employees. " +
  "Buyer available capital is $8M. Remaining financing is debt.";

// --- (a) verified deal-fact extraction ----------------------------------

test("extractAcquisitionDealFacts parses every explicit user fact in the exact scenario prompt", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);

  assert.equal(facts.purchasePrice, 14_000_000);
  assert.equal(facts.targetArr, 2_800_000);
  assert.equal(facts.enterpriseCustomers, 150);
  assert.equal(facts.employees, 18);
  assert.equal(facts.buyerAvailableCapital, 8_000_000);
  assert.equal(facts.remainingFinancingType, "debt");
});

test("extractAcquisitionDealFacts respects the negation guard -- a negated figure is never extracted as real", () => {
  const facts = extractAcquisitionDealFacts(
    "The buyer does not have $8M available capital, and there are no enterprise customers yet."
  );

  assert.equal(facts.buyerAvailableCapital, null);
  assert.equal(facts.enterpriseCustomers, null);
});

test("extractAcquisitionDealFacts returns null fields (never fabricates) when a fact is simply absent from the prompt", () => {
  const facts = extractAcquisitionDealFacts("We are evaluating a possible acquisition target.");

  assert.equal(facts.purchasePrice, null);
  assert.equal(facts.targetArr, null);
  assert.equal(facts.enterpriseCustomers, null);
  assert.equal(facts.employees, null);
  assert.equal(facts.buyerAvailableCapital, null);
  assert.equal(facts.remainingFinancingType, null);
});

test("formatVerifiedDealFactsBlock labels every extracted fact [Verified], never [Derived]", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const block = formatVerifiedDealFactsBlock(facts);

  assert.ok(block);
  assert.match(block, /\[Verified\] Purchase price: \$14M/);
  assert.match(block, /\[Verified\] Target ARR: \$2\.8M/);
  assert.match(block, /\[Verified\] Enterprise customers: 150/);
  assert.match(block, /\[Verified\] Employees: 18/);
  assert.match(block, /\[Verified\] Buyer available capital: \$8M/);
  assert.match(block, /\[Verified\] Remaining financing: debt/);
  assert.doesNotMatch(block, /\[Derived\]/);
});

// --- (b) EV/ARR calculation ----------------------------------------------

test("computeAcquisitionDerivedMetrics computes EV/ARR = 5.0x for the exact scenario", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);

  assert.equal(derived.evToArr, 5.0);
});

test("computeAcquisitionDerivedMetrics leaves EV/ARR null when target ARR is missing or zero (never divides by a missing/zero value)", () => {
  assert.equal(
    computeAcquisitionDerivedMetrics({
      purchasePrice: 14_000_000,
      targetArr: null,
      enterpriseCustomers: null,
      employees: null,
      buyerAvailableCapital: null,
      remainingFinancingType: null,
    }).evToArr,
    null
  );

  assert.equal(
    computeAcquisitionDerivedMetrics({
      purchasePrice: 14_000_000,
      targetArr: 0,
      enterpriseCustomers: null,
      employees: null,
      buyerAvailableCapital: null,
      remainingFinancingType: null,
    }).evToArr,
    null
  );
});

test("formatDerivedValuationBlock labels EV/ARR [Derived], never [Verified]", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);
  const block = formatDerivedValuationBlock(derived);

  assert.ok(block);
  assert.match(block, /\[Derived\] EV\/ARR: 5\.1x|\[Derived\] EV\/ARR: 5x|\[Derived\] EV\/ARR: 5\.0x/);
  assert.doesNotMatch(block, /\[Verified\]/);
});

// --- (c) financing split --------------------------------------------------

test("computeAcquisitionDerivedMetrics computes the exact financing split for the scenario: $8M equity, $6M debt, 42.9%/57.1% split", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);

  assert.equal(derived.equityContribution, 8_000_000);
  assert.equal(derived.debtRequirement, 6_000_000);
  assert.equal(derived.debtSharePercent, 42.9);
  assert.equal(derived.equitySharePercent, 57.1);
});

test("formatDerivedFinancingBlock labels every financing metric [Derived], never [Verified]", () => {
  const facts = extractAcquisitionDealFacts(scenarioPrompt);
  const derived = computeAcquisitionDerivedMetrics(facts);
  const block = formatDerivedFinancingBlock(derived);

  assert.ok(block);
  assert.match(block, /\[Derived\] Equity contribution: \$8M/);
  assert.match(block, /\[Derived\] Debt requirement: \$6M/);
  assert.match(block, /\[Derived\] Debt share of purchase price: 42\.9%/);
  assert.match(block, /\[Derived\] Equity share: 57\.1%/);
  assert.doesNotMatch(block, /\[Verified\]/);
});

test("computeAcquisitionDerivedMetrics never lets debt requirement go negative when buyer capital exceeds purchase price", () => {
  const derived = computeAcquisitionDerivedMetrics({
    purchasePrice: 14_000_000,
    targetArr: 2_800_000,
    enterpriseCustomers: null,
    employees: null,
    buyerAvailableCapital: 20_000_000,
    remainingFinancingType: null,
  });

  assert.equal(derived.equityContribution, 14_000_000);
  assert.equal(derived.debtRequirement, 0);
  assert.equal(derived.debtSharePercent, 0);
  assert.equal(derived.equitySharePercent, 100);
});

// --- (d) rejection of irrelevant sources -----------------------------------
// Mirrors plan-executor.ts's exact implementation (heavy Supabase/auth
// dependencies prevent clean direct import -- established convention used
// elsewhere in this suite, e.g. aml-fraud-geography-and-source-relevance-fixes).

const acquisitionDomainRelevantSignals =
  /\b(m&a|merger|acquisition|due diligence|valuation|ev\/arr|purchase price|earnout|leveraged buyout|\blbo\b|debt financing|credit facility|term loan|private equity|corporate development|antitrust|competition authority|merger control|germany|deutschland|european union|\beu\b|gdpr|dora|digital operational resilience|bafin|bundesbank|european central bank|\becb\b|cybersecurity|information security|infosec|saas valuation|arr multiple|revenue multiple)\b/i;

const acquisitionIrrelevantSourceSignals =
  /\b(hhs\.gov|department of health and human services|who\.int|world health organization|apa\.org|american psychological association|mba\.com|wikipedia|\.edu\b|university of|college of|centers for disease control|cdc\.gov|hospital|clinic|patient care|medical school|nih\.gov|national institutes of health)\b/i;

function prioritizeAcquisitionRelevantEvidence(evidence) {
  const sourceText = (item) =>
    `${item.sourceTitle} ${item.publisher} ${item.url} ${item.claim} ${item.value}`;
  const relevant = [];
  const rest = [];

  for (const item of evidence) {
    const text = sourceText(item);
    if (acquisitionIrrelevantSourceSignals.test(text)) continue;
    if (acquisitionDomainRelevantSignals.test(text)) {
      relevant.push(item);
    } else {
      rest.push(item);
    }
  }

  return [...relevant, ...rest];
}

function evidenceItem(overrides) {
  return {
    id: "R1",
    field: "valuation",
    claim: "",
    value: "",
    sourceTitle: "",
    publisher: "",
    url: "",
    publishedDate: "",
    ...overrides,
  };
}

test("prioritizeAcquisitionRelevantEvidence rejects every named irrelevant source: HHS, WHO, APA, MBA.com, Wikipedia, education/healthcare", () => {
  const evidence = [
    evidenceItem({ id: "R1", sourceTitle: "Guidance", publisher: "Department of Health and Human Services", url: "https://hhs.gov/guidance" }),
    evidenceItem({ id: "R2", sourceTitle: "Report", publisher: "World Health Organization", url: "https://who.int/report" }),
    evidenceItem({ id: "R3", sourceTitle: "Standards", publisher: "American Psychological Association", url: "https://apa.org/standards" }),
    evidenceItem({ id: "R4", sourceTitle: "MBA Rankings", publisher: "MBA.com", url: "https://mba.com/rankings" }),
    evidenceItem({ id: "R5", sourceTitle: "M&A article", publisher: "Wikipedia", url: "https://en.wikipedia.org/wiki/Mergers_and_acquisitions" }),
    evidenceItem({ id: "R6", sourceTitle: "Case study", publisher: "Harvard Business School", url: "https://hbs.edu/case-study" }),
    evidenceItem({ id: "R7", sourceTitle: "Patient outcomes", publisher: "General Hospital", url: "https://hospital.example.com/outcomes" }),
    evidenceItem({ id: "R8", sourceTitle: "EV/ARR Benchmarks for SaaS", publisher: "SaaS Capital", url: "https://saas-capital.example.com/benchmarks", claim: "SaaS valuation multiples" }),
  ];

  const filtered = prioritizeAcquisitionRelevantEvidence(evidence);
  const ids = filtered.map((item) => item.id);

  assert.ok(!ids.includes("R1"), "HHS source should be rejected");
  assert.ok(!ids.includes("R2"), "WHO source should be rejected");
  assert.ok(!ids.includes("R3"), "APA source should be rejected");
  assert.ok(!ids.includes("R4"), "MBA.com source should be rejected");
  assert.ok(!ids.includes("R5"), "Wikipedia source should be rejected");
  assert.ok(!ids.includes("R6"), ".edu source should be rejected");
  assert.ok(!ids.includes("R7"), "hospital/healthcare source should be rejected");
  assert.ok(ids.includes("R8"), "domain-relevant SaaS valuation source should be preserved");
});

test("prioritizeAcquisitionRelevantEvidence prioritizes Germany/EU M&A, cybersecurity, SaaS valuation, and debt financing sources first", () => {
  const evidence = [
    evidenceItem({ id: "R1", sourceTitle: "General market note", publisher: "Some Analyst", url: "https://analyst.example.com/note" }),
    evidenceItem({ id: "R2", sourceTitle: "DORA compliance requirements for financial entities", publisher: "BaFin", url: "https://bafin.de/dora", claim: "Digital Operational Resilience Act" }),
    evidenceItem({ id: "R3", sourceTitle: "German merger control thresholds", publisher: "Bundeskartellamt", url: "https://bundeskartellamt.de/merger-control", claim: "competition authority review" }),
    evidenceItem({ id: "R4", sourceTitle: "Cybersecurity M&A due diligence checklist", publisher: "Industry Group", url: "https://industry.example.com/checklist" }),
  ];

  const filtered = prioritizeAcquisitionRelevantEvidence(evidence);

  assert.deepEqual(filtered.map((item) => item.id), ["R2", "R3", "R4", "R1"]);
});

test("prioritizeAcquisitionRelevantEvidence never fabricates a source -- only reorders/drops real evidence", () => {
  const evidence = [
    evidenceItem({ id: "R1", publisher: "BaFin" }),
    evidenceItem({ id: "R2", publisher: "Some Regulator" }),
  ];
  const filtered = prioritizeAcquisitionRelevantEvidence(evidence);

  assert.ok(filtered.length <= evidence.length);
  for (const item of filtered) {
    assert.ok(evidence.includes(item), "every filtered item must be a real, original evidence object");
  }
});

test("plan-executor.ts wires the acquisition source filter into both the model-facing research context and the deterministic sources field (drift check)", () => {
  assert.match(planExecutorSource, /prioritizeAcquisitionRelevantEvidence\(domainResearch\.evidence\)/);
  assert.match(planExecutorSource, /prioritizeAcquisitionRelevantEvidence\(research\.evidence\)/);

  const fnMatch = /function prioritizeAcquisitionRelevantEvidence\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "prioritizeAcquisitionRelevantEvidence not found");
  assert.doesNotMatch(fnMatch[0], /new\s+\{|push\(\{/, "the filter must never construct new evidence objects");
});

test("plan-executor.ts's acquisition sources field states explicitly when no relevant evidence exists, rather than blocking the report (drift check)", () => {
  assert.match(
    planExecutorSource,
    /No directly relevant external evidence was found for this deal\. This assessment relies on the user-verified deal facts and the calculations derived from them\./
  );
});

// --- (e) non-empty acquisition sections ------------------------------------

test("buildAcquisitionAnalysisInstructions requires substantive, deal-specific analysis in every field -- never empty (drift check)", () => {
  assert.match(
    acquisitionAnalysisSource,
    /Every field must contain substantive, deal-specific analysis of at least several sentences grounded in the verified deal facts, derived metrics, uploaded assets, and research provided\./
  );
});

// NOTE: superseded by the "improve acquisition analysis depth" turn --
// the required 30/60/90-day milestones were explicitly redefined (30
// days: financial validation, customer contract review, security
// assessment, employee retention plan; 60 days: technology integration,
// operating-model alignment, customer strategy; 90 days: synergy
// tracking, unified roadmap, KPI review), replacing the earlier
// "legal and financial close"/"security architecture audit"/
// "retention-risk mapping" phrasing.
test("postMergerIntegrationPlan prompt requires a real, deal-specific 30\\/60\\/90-day plan with the requested milestones (drift check)", () => {
  const fnMatch = /postMergerIntegrationPlan:\s*\n?\s*"([\s\S]*?)",\n/.exec(acquisitionAnalysisSource);
  assert.ok(fnMatch, "postMergerIntegrationPlan prompt not found");
  const prompt = fnMatch[1];

  assert.match(prompt, /financial validation/i);
  assert.match(prompt, /customer contract review/i);
  assert.match(prompt, /security assessment/i);
  assert.match(prompt, /employee retention plan/i);
  assert.match(prompt, /technology integration/i);
  assert.match(prompt, /operating-model alignment/i);
  assert.match(prompt, /customer strategy/i);
  assert.match(prompt, /synergy tracking/i);
  assert.match(prompt, /unified go-to-market roadmap/i);
  assert.match(prompt, /KPI review/i);
  assert.match(prompt, /never a generic template/i);
});

test("applyAcquisitionDeterministicOverrides guarantees targetCompanyOverview, valuationAnalysis, and financingStructure are never left with only model output when verified facts/derived metrics exist (drift check)", () => {
  const fnMatch = /function applyAcquisitionDeterministicOverrides\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "applyAcquisitionDeterministicOverrides not found");

  assert.match(fnMatch[0], /updated\.targetCompanyOverview = \[verifiedFactsBlock, updated\.targetCompanyOverview\]/);
  assert.match(fnMatch[0], /updated\.valuationAnalysis = \[valuationDerivedBlock, updated\.valuationAnalysis\]/);
  assert.match(fnMatch[0], /updated\.financingStructure = \[financingDerivedBlock, updated\.financingStructure\]/);
});

// --- (f) no generic "See X" placeholder fallbacks ---------------------------

test("serializeAcquisitionAnalysisReportChunks never runs the cross-section paragraph deduper that produces the 'See X for established premise' placeholder (drift check, root-cause fix)", () => {
  const fnMatch = /function serializeAcquisitionAnalysisReportChunks\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "serializeAcquisitionAnalysisReportChunks not found");
  assert.doesNotMatch(fnMatch[0], /dedupeReportParagraphsAcrossSections/);
});

test("acquisition analysis instructions explicitly forbid a bare 'see [section]' cross-reference placeholder (drift check)", () => {
  assert.match(
    acquisitionAnalysisSource,
    /Never write a bare cross-reference such as 'see \[section\] for the established premise' or similar/
  );
});

test("acquisition generation prompt instructs graceful degradation instead of an empty section or a blocked report when evidence is unavailable (drift check)", () => {
  assert.match(planExecutorSource, /never leave a section empty and never fail the report/i);
});
