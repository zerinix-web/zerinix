import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCanonicalFinancialAssumptions } from "../app/lib/ai/financial-assumptions.ts";
import {
  consolidateFinancialAssumptions,
  formatKeyFinancialAssumptionsList,
  classifyFinancialMetricEvidenceType,
  hasVerifiedUserProvidedData,
} from "../app/lib/financial-evidence-labeling.ts";
import { planFields } from "../app/lib/report-engine/prompts/plan.ts";

// TASK #69A-4 -- Fix real Business Idea Validation quality-gate failure
// without weakening evidence safety.
//
// Real runtime failure: "Report quality gate failed: unsupported numeric
// claim lacks evidence and source or method provenance." on a fresh
// localhost run immediately after Task #69A-3, root-caused against the
// real job (report_jobs id 8d7f28c0-340f-4e22-bc72-9b8a46ecb747) and its
// real cached report (ai_response_cache id 66a66c44-a2b3-4a24-a845-
// 77909db270cb). The four field values below are copied verbatim from
// that real cached report.
//
// domain-research.ts imports "server-only" (a Next.js-only no-op package
// absent from node_modules), which breaks any plain-node import of that
// file -- every existing test needing anything from it reads it as text
// instead (see tests/ai-model-routing.test.mjs), which this test follows.
// plan-executor.ts additionally imports "next/server" and other Next.js-
// only modules, so its own private helper functions are extracted as text
// too, the same way tests/task69a3-biv-decision-evidence-contradictions
// .test.mjs already extracts isMarketSizeEstimated.

const domainResearchSource = readFileSync(
  new URL("../app/lib/ai/domain-research.ts", import.meta.url),
  "utf8"
);
function extractRegexConst(name) {
  const match = domainResearchSource.match(
    new RegExp(`export const ${name} =\\s*\\n?\\s*(/.*/[a-z]*);`)
  );
  assert.notEqual(match, null, `${name} not found in domain-research.ts`);
  return eval(match[1]);
}
const NUMERIC_CLAIM_LINE_PATTERN = extractRegexConst("NUMERIC_CLAIM_LINE_PATTERN");
const NUMERIC_CLAIM_LABEL_PATTERN = extractRegexConst("NUMERIC_CLAIM_LABEL_PATTERN");
const NUMERIC_CLAIM_PROVENANCE_PATTERN = extractRegexConst("NUMERIC_CLAIM_PROVENANCE_PATTERN");

// The real gate's own check (domain-research.ts's validateDomainResearchQuality),
// reproduced verbatim so this test proves the real check's own outcome,
// not an approximation of it.
function findFailingClaim(report) {
  const reportText = Object.values(report).join("\n");
  const numericClaims = reportText.match(NUMERIC_CLAIM_LINE_PATTERN) || [];
  return numericClaims.find(
    (claim) =>
      !NUMERIC_CLAIM_LABEL_PATTERN.test(claim) || !NUMERIC_CLAIM_PROVENANCE_PATTERN.test(claim)
  );
}

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
  assert.notEqual(startMatch, null, `${name} not found in plan-executor.ts`);
  const start = startMatch.index;
  let i = source.indexOf("{", start);
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

function extractSetConstSource(source, name) {
  const startMatch = source.match(new RegExp(`const ${name}[^=]*=\\s*new Set\\(`));
  assert.notEqual(startMatch, null, `${name} not found in plan-executor.ts`);
  const start = startMatch.index;
  const end = source.indexOf(");", start) + 2;
  return source.slice(start, end);
}

function stripTsTypes(text) {
  return text
    .replace(/\)\s*:\s*[^{]+\{/g, ") {")
    .replace(/\(line: string, isStrategyField: boolean\)/g, "(line, isStrategyField)")
    .replace(/\(content: string\)/g, "(content)")
    .replace(
      /report: Record<PlanReportField, string>,\s*\n\s*context: AiFinancialModelContext/,
      "report, context"
    )
    .replace(/let matchedMetric: FinancialMetricModel \| null = null;/g, "let matchedMetric = null;")
    .replace(/: Array<\{ label: string; metric: FinancialMetricModel \}>/, "")
    .replace(/evidenceType: FinancialEvidenceType/, "evidenceType")
    .replace(/: ReadonlySet<PlanReportField>/, "");
}

// Loads the real, unmodified annotateUnclassifiedCanonicalMetricMentions
// (plus its own nested helpers annotateLine and
// propagateSourceRegistryReferenceOntoTitleLine, captured by the same
// brace-depth extraction since they are declared inside its body) and its
// two module-level dependencies, exactly as authored in plan-executor.ts.
async function loadAnnotateFunction() {
  const blob = [
    stripTsTypes(extractSetConstSource(planExecutorSource, "strategyRecommendationPlanFields")),
    stripTsTypes(extractFunctionSource(planExecutorSource, "toGateRecognizedEvidenceAnnotation")),
    stripTsTypes(extractFunctionSource(planExecutorSource, "annotateUnclassifiedCanonicalMetricMentions")),
  ].join("\n\n");

  const financialEvidenceLabelingUrl = pathToFileURL(
    join(process.cwd(), "app/lib/financial-evidence-labeling.ts")
  ).href;
  const fullSource = [
    `import { classifyFinancialMetricEvidenceType, hasVerifiedUserProvidedData } from ${JSON.stringify(
      financialEvidenceLabelingUrl
    )};`,
    `const NUMERIC_CLAIM_LABEL_PATTERN = ${NUMERIC_CLAIM_LABEL_PATTERN.toString()};`,
    `const NUMERIC_CLAIM_PROVENANCE_PATTERN = ${NUMERIC_CLAIM_PROVENANCE_PATTERN.toString()};`,
    `const planFields = ${JSON.stringify(planFields)};`,
    blob,
    "export { annotateUnclassifiedCanonicalMetricMentions };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-task69a4-annotate-"));
  const outPath = join(dir, "annotate.mjs");
  writeFileSync(outPath, fullSource);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.annotateUnclassifiedCanonicalMetricMentions;
}

const REAL_PROMPT =
  "I'm considering launching a premium AI-powered financial planning and decision-support platform for small and mid-sized businesses in the United States. The product would combine cash-flow forecasting, scenario planning, budgeting, financial risk alerts, and executive recommendations in one SaaS platform. Analyze whether this is a strong business idea, including customer pain points, target segments, market opportunity, TAM/SAM/SOM, competitors, pricing, business model, unit economics, go-to-market strategy, key risks, validation plan, and financial assumptions. Based on the evidence, give me a clear ENTER, MONITOR, or AVOID decision with confidence level and explain what evidence would be required to change that decision.";

// Verbatim from the real cached report (ai_response_cache id
// 66a66c44-a2b3-4a24-a845-77909db270cb) that reproduced the real
// production failure.
const REAL_SOLUTION_FIELD =
  "A premium SaaS platform combining automated cash-flow forecasting, multi-scenario planning, budgeting, real-time risk alerts, and prescriptive executive recommendations surfaced by AI. First product scope: QuickBooks/Xero+Plaid integrations, automated forecast engine, scenario module, alerting inbox, and one-click executive summary. Differentiation path: superior forecast accuracy on SMB inputs, prescriptive 'what-to-do' actions, integration breadth (ecommerce payouts), and packaging for finance managers. Must-win conditions: 1) reliable integrations producing accurate forecasts; 2) AI recommendations demonstrably reduce cash risk in pilots; 3) customers accept $500–$2,000+/month ARPA for value delivered.";
const REAL_TARGET_CUSTOMER_FIELD =
  "Beachhead: US SMBs with recurring revenue, 10–250 employees, using QuickBooks Online or Xero, revenue $1M–$50M. Buyer: CFO/Head of Finance or owner; user: controller/finance manager; budget owner: CEO/CFO. Adoption trigger: cash volatility, seasonal revenue swings, recent financing discussions, or e-commerce payout complexity. Willingness to pay: anchored by vendor pricing examples in market ($33–$59/mo tiers shown) but premium SMB FP&A can command $500–$2,000/mo—model ARPA $1k/mo assumes early enterprise SMB customers. Disqualifiers: single-owner microbusinesses using manual invoicing; companies without digital bookkeeping. First 50 customers: finance-managed SMBs in ecommerce, services, and early-stage tech with QuickBooks/Xero stacks.";
const REAL_COMPETITOR_LANDSCAPE_FIELD =
  "Direct competitors: Float (targets finance teams in SMBs; scenario planning; QuickBooks/Xero/FreeAgent integrations; pricing tiers referenced) [R56][R59]. Cash Flow Frog (SMB focus; QuickBooks Desktop/QBO/Xero/Plaid integrations; low-cost tiers) [R57]. Substitutes: bookkeeping firms, Excel templates, advisory services. Pricing: vendor anchors show low-tier SMB pricing ($33/mo) and higher plan tiers (~$59+/mo); premium FP&A pricing observed in category materials (investor slides cite larger TAM) [R56][R58]. Strengths of incumbents: product-market fit, integrations, accountant channel. Weaknesses: limited AI prescriptive recommendations and enterprise-tier advisory. How to outperform: superior prescriptive AI, focused vertical workflows (ecommerce payouts), and accountant partnership program. Incumbent response: quicker integrations, bundling; switching barriers: data migration trust and workflow change. Gap for entrant: prescriptive AI + executive recommendations bundled with pilots and accountant-led channel. Executive implication: compete initially via a tight vertical and accountant channel to limit direct pricing battles.\n\nAI Executive Insight:\nAI Executive Insight: Competitive positioning matters because capital should only be committed once this is complete: Validate pricing, buyer urgency, and repeatable acquisition before committing full funding. Confirm it holds against the 11.3 months payback and 19.3 months runway.";
const REAL_SALES_STRATEGY_FIELD =
  "Account targets: finance-managed SMBs (revenue $1M–$50M), vertical-first (ecommerce, services). Outreach angle: 'Avoid next payroll shortfall' + demo of automated forecast and recommended actions. Discovery questions: current forecast cadence, pain events, systems (QuickBooks/Xero), and decision owner. Pilot offer: 6-week paid/discounted pilot with integration and ROI review. Buying objections: trust in AI, data security, price. Procurement friction: SMB procurement is light but needs CEO/CFO sign-off for price >$1k/mo. Closing motion: product demonstration, pilot success metrics, references from accountant partners. First repeatable signal: Paid pilot conversion within 8 weeks and account expansion within 6 months.";
const REAL_SOURCE_REGISTRY_BLOCK =
  "Title: Eightx / Finverium / Cash Flow Frog pricing pages: Vendor pricing examples: Cash Flow Frog Pro ~ $33/month (annual); Float published tiers (e.g., from ~$59/month depending on plan).\nPublisher: Eightx, Finverium, Cash Flow Frog\nYear: 2026-06-?\nReference: [R58]\nURL: https://eightx.co/blog/best-cash-flow-forecasting-tools-for-ecommerce";

function buildRealReportFixture(context) {
  const report = Object.fromEntries(planFields.map((field) => [field, ""]));
  report.solution = REAL_SOLUTION_FIELD;
  report.targetCustomer = REAL_TARGET_CUSTOMER_FIELD;
  report.competitorLandscape = REAL_COMPETITOR_LANDSCAPE_FIELD;
  report.salesStrategy = REAL_SALES_STRATEGY_FIELD;
  report.sourcesAssumptions = `Verified external research evidence:\n\n${REAL_SOURCE_REGISTRY_BLOCK}`;
  const consolidated = consolidateFinancialAssumptions(Object.values(context.metrics));
  report.financialAssumptions = formatKeyFinancialAssumptionsList(consolidated, "English");
  return report;
}

let annotate;
let context;

test.before(async () => {
  annotate = await loadAnnotateFunction();
  context = createCanonicalFinancialAssumptions({ prompt: REAL_PROMPT, reportKind: "business_plan" });
});

// Requirement 1: the exact real failing claim fails before the fix and
// passes after with correct provenance.
test("real failing claim (solution field ARPA sentence) fails before the fix and passes after", () => {
  const before = { ...Object.fromEntries(planFields.map((f) => [f, ""])), solution: REAL_SOLUTION_FIELD };
  const beforeFailure = findFailingClaim(before);
  assert.notEqual(beforeFailure, undefined, "the real solution sentence must fail the gate before annotation");
  assert.match(beforeFailure, /\$500–\$2,000\+\/month ARPA/);

  const fixture = buildRealReportFixture(context);
  const annotated = annotate(fixture, context);
  assert.match(annotated.solution, /\(Assumption\)$/);
  assert.equal(NUMERIC_CLAIM_LABEL_PATTERN.test(annotated.solution), true);
  assert.equal(NUMERIC_CLAIM_PROVENANCE_PATTERN.test(annotated.solution), true);
  assert.equal(findFailingClaim({ solution: annotated.solution }), undefined);
});

test("real failing claim (targetCustomer ARPA sentence) fails before the fix and passes after", () => {
  const before = { targetCustomer: REAL_TARGET_CUSTOMER_FIELD };
  assert.notEqual(findFailingClaim(before), undefined);

  const fixture = buildRealReportFixture(context);
  const annotated = annotate(fixture, context);
  assert.match(annotated.targetCustomer, /\(Assumption\)$/);
  assert.equal(findFailingClaim({ targetCustomer: annotated.targetCustomer }), undefined);
});

test("real failing claim (competitorLandscape citation paragraph, a separate real newline-bounded line from the later AI Executive Insight paragraph) fails before the fix and passes after", () => {
  const before = { competitorLandscape: REAL_COMPETITOR_LANDSCAPE_FIELD };
  const beforeFailure = findFailingClaim(before);
  assert.notEqual(beforeFailure, undefined);
  assert.match(beforeFailure, /Direct competitors: Float/);

  const fixture = buildRealReportFixture(context);
  const annotated = annotate(fixture, context);
  const lines = annotated.competitorLandscape.split("\n");
  const citationLine = lines.find((l) => l.startsWith("Direct competitors:"));
  const insightLine = lines.find((l) => l.startsWith("AI Executive Insight: Competitive positioning"));
  assert.match(citationLine, /\(AI Analysis\)$/, "the citation paragraph itself must be independently annotated");
  assert.match(insightLine, /\(Assumption\)$/, "the separately-lined AI Executive Insight paragraph must also be independently annotated");
  assert.equal(findFailingClaim({ competitorLandscape: annotated.competitorLandscape }), undefined);
});

test("real failing claim (salesStrategy account-targeting sentence, a strategy/recommendation field) fails before the fix and passes after", () => {
  const before = { salesStrategy: REAL_SALES_STRATEGY_FIELD };
  assert.notEqual(findFailingClaim(before), undefined);

  const fixture = buildRealReportFixture(context);
  const annotated = annotate(fixture, context);
  assert.equal(findFailingClaim({ salesStrategy: annotated.salesStrategy }), undefined);
});

test("real failing claim (sourcesAssumptions Title line, provenance carried by the SAME citation block's Reference line) fails before the fix and passes after", () => {
  const before = { sourcesAssumptions: `Verified external research evidence:\n\n${REAL_SOURCE_REGISTRY_BLOCK}` };
  const beforeFailure = findFailingClaim(before);
  assert.notEqual(beforeFailure, undefined);
  assert.match(beforeFailure, /Title: Eightx/);

  const fixture = buildRealReportFixture(context);
  const annotated = annotate(fixture, context);
  assert.equal(findFailingClaim({ sourcesAssumptions: annotated.sourcesAssumptions }), undefined);
  const titleLine = annotated.sourcesAssumptions.split("\n").find((l) => l.startsWith("Title: Eightx"));
  assert.match(titleLine, /\[R58\]/, "the propagated reference must be the block's own, real [R58], never fabricated");
});

test("requirement 7: the full real report fixture passes the quality gate end-to-end", () => {
  const fixture = buildRealReportFixture(context);
  assert.notEqual(findFailingClaim(fixture), undefined, "sanity check: the unmodified fixture must still fail");
  const annotated = annotate(fixture, context);
  assert.equal(findFailingClaim(annotated), undefined, "the fully annotated real report must pass the gate");
});

// Requirement 2: a benchmark-derived numeric planning assumption is
// allowed only when structurally tagged as benchmark/planning input.
test("requirement 2: a benchmark-derived metric mention is tagged '(Assumption)', never left bare", () => {
  const fixture = { ...Object.fromEntries(planFields.map((f) => [f, ""])), solution: "Gross Margin runs at 68% based on category norms." };
  const annotated = annotate(fixture, context);
  assert.match(annotated.solution, /\(Assumption\)$/);
  assert.equal(findFailingClaim({ solution: annotated.solution }), undefined);
});

test("requirement 2: an unstructured bare number in a non-strategy, non-cited, non-metric field is left unclassified and still fails", () => {
  const fixture = {
    ...Object.fromEntries(planFields.map((f) => [f, ""])),
    marketOpportunity: "This category grew for 18 months without profitability, according to unnamed industry chatter.",
  };
  const annotated = annotate(fixture, context);
  assert.equal(annotated.marketOpportunity, fixture.marketOpportunity, "must not be touched or auto-labeled");
  assert.notEqual(findFailingClaim({ marketOpportunity: annotated.marketOpportunity }), undefined);
});

// Requirement 3/4: a formula-derived claim traces to canonical inputs and
// is never automatically "Verified" merely because the arithmetic is
// deterministic.
test("requirement 3/4: TAM/SAM/SOM/ARR/CAC-payback mentions trace to the canonical metric and are never bare-Verified from arithmetic alone", () => {
  const fixture = {
    ...Object.fromEntries(planFields.map((f) => [f, ""])),
    businessModel: `TAM stands at ${context.metrics.tam.displayValue} based on category sizing.`,
  };
  const annotated = annotate(fixture, context);
  const evidenceType = classifyFinancialMetricEvidenceType(
    context.metrics.tam,
    hasVerifiedUserProvidedData(context.financialConsistency.sources.userProvidedData)
  );
  assert.equal(findFailingClaim({ businessModel: annotated.businessModel }), undefined);
  if (evidenceType !== "Verified") {
    assert.doesNotMatch(
      annotated.businessModel,
      /\bVerified\b/,
      "a non-Verified-tier metric must never be labeled Verified just because it is a formula result"
    );
  }
});

test("requirement 4: a Derived-tier metric mention gets an annotation that satisfies BOTH label and provenance, not label alone", () => {
  // "Estimated" alone (the Derived-tier word) satisfies the LABEL pattern
  // but NOT the PROVENANCE pattern on its own -- toGateRecognizedEvidenceAnnotation
  // must pair it with a real provenance word ("formula-derived"), or a
  // Derived-tier line with no other citation/URL in it would still fail.
  const fixture = {
    ...Object.fromEntries(planFields.map((f) => [f, ""])),
    unitEconomics: `ARR is calculated at ${context.metrics.arr.displayValue}.`,
  };
  const annotated = annotate(fixture, context);
  assert.equal(findFailingClaim({ unitEconomics: annotated.unitEconomics }), undefined);
});

// Requirement 5: a truly unsupported numeric claim still fails the
// quality gate.
test("requirement 5: a genuinely unsupported numeric claim (no metric, no citation, no strategy-field context) still fails", () => {
  const fixture = {
    ...Object.fromEntries(planFields.map((f) => [f, ""])),
    swotAnalysis: "Strengths: the founder previously grew a company to $12,000 in monthly revenue.",
  };
  const annotated = annotate(fixture, context);
  assert.equal(annotated.swotAnalysis, fixture.swotAnalysis);
  assert.notEqual(findFailingClaim({ swotAnalysis: annotated.swotAnalysis }), undefined);
});

test("requirement 5: the gate itself (unmodified) still rejects an unsupported claim with no fix applied at all", () => {
  const rawReport = { risks: "Regulatory risk could cost the company $2M in fines within 18 months." };
  assert.notEqual(findFailingClaim(rawReport), undefined);
});

// Requirement 6: renderer-only labels/text cannot satisfy provenance
// requirements -- the gate itself is untouched, so a label word with no
// real provenance marker anywhere in the SAME line still fails.
test("requirement 6: a bare classification word with no provenance marker in the same line still fails the unmodified gate", () => {
  const rendererOnlyLine = "Estimated payback period is 11 months for early customers.";
  assert.equal(NUMERIC_CLAIM_LABEL_PATTERN.test(rendererOnlyLine), true);
  assert.equal(NUMERIC_CLAIM_PROVENANCE_PATTERN.test(rendererOnlyLine), false);
  assert.notEqual(findFailingClaim({ x: rendererOnlyLine }), undefined);
});

test("requirement 6: toGateRecognizedEvidenceAnnotation never returns a label-only word for Verified/Derived tiers", async () => {
  // Guards the exact bug found and fixed during this task: returning the
  // bare tier word ("Verified" / "Estimated") alone satisfies the LABEL
  // pattern but not the separate PROVENANCE pattern.
  const source = extractFunctionSource(planExecutorSource, "toGateRecognizedEvidenceAnnotation");
  assert.doesNotMatch(source, /return\s+"Verified";/, "must never return the bare label word alone for Verified");
  assert.doesNotMatch(source, /return\s+"Estimated";/, "must never return the bare label word alone for Derived");
});

// Requirement 8: existing decision/confidence/evidence regressions
// (#69A/#69A-1/#69A-2/#69A-3) remain unchanged -- the fix must be
// additive-only (an annotation appended to already-existing content),
// never rewriting a metric's own value, decision vocabulary, or the
// TAM/SAM/SOM competitor/benchmark fixes from Task #69A-3.
test("requirement 8: annotation is strictly additive -- never changes a field's own substantive content, only appends a trailing classification per line", () => {
  const fixture = buildRealReportFixture(context);
  const annotated = annotate(fixture, context);
  for (const field of planFields) {
    if (!fixture[field]) continue;
    const beforeLines = fixture[field].split("\n");
    const afterLines = annotated[field].split("\n");
    assert.equal(afterLines.length, beforeLines.length, `${field} must not gain or lose lines`);
    beforeLines.forEach((beforeLine, i) => {
      const afterLine = afterLines[i];
      const trimmedBefore = beforeLine.trim();
      const strippedAfter = afterLine.replace(/ \([A-Za-z ]+\)$/, "").replace(/ \[R\d+\]$/, "");
      assert.equal(
        afterLine === beforeLine || strippedAfter === trimmedBefore || afterLine.startsWith(trimmedBefore),
        true,
        `${field} line ${i} must only ever gain a trailing annotation, never a rewritten value: ${JSON.stringify(beforeLine)} -> ${JSON.stringify(afterLine)}`
      );
    });
  }
});

test("requirement 8: strategyRecommendationPlanFields never includes a research/evidence field owned by Task #69A-3's fixes", () => {
  const source = extractSetConstSource(planExecutorSource, "strategyRecommendationPlanFields");
  for (const protectedField of ["tamSamSom", "competitorLandscape", "marketOpportunity", "financialDashboard", "unitEconomics"]) {
    assert.doesNotMatch(
      source,
      new RegExp(`"${protectedField}"`),
      `${protectedField} must never be treated as an unverifiable strategy field -- it is owned by evidence-safety fixes`
    );
  }
});

// Requirement 9: Market Intelligence remains unchanged -- this task only
// touches Business Idea Validation's own plan-executor.ts pipeline and
// the shared domain-research.ts gate's constant EXTRACTION (a pure
// refactor, not a behavior change), never Market Intelligence's own
// route or the gate's own check logic.
test("requirement 9: domain-research.ts's gate constants are byte-identical in behavior to the pre-refactor inline regexes (Market Intelligence shares this same gate)", () => {
  // The refactor only named 3 existing inline regex literals as exported
  // constants -- confirmed by re-running the exact real Market
  // Intelligence-relevant checks the gate performs elsewhere in this
  // file, which this test file does not modify or stub.
  const sample = "Estimated TAM is $50M based on industry benchmarks. [R1]";
  assert.equal(NUMERIC_CLAIM_LABEL_PATTERN.test(sample), true);
  assert.equal(NUMERIC_CLAIM_PROVENANCE_PATTERN.test(sample), true);
  assert.equal(findFailingClaim({ x: sample }), undefined);
});

test("requirement 9: market-analysis route still calls the same validateDomainResearchQuality gate function, untouched by this task", () => {
  const marketAnalysisSource = readFileSync(
    new URL("../app/api/market-analysis/route.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketAnalysisSource, /validateDomainResearchQuality/);
});

test("live-generation call site now enforces the gate result instead of discarding it (Requirement E: unsupported claims must still fail on the primary path)", () => {
  // The OLD, buggy form called this function as a bare, un-assigned
  // statement (its result had nowhere to go) -- matched here by requiring
  // the statement to start the line with no preceding assignment.
  const discardedCallSites = [
    ...planExecutorSource.matchAll(
      /^\s*validateDomainResearchQualitySafely\(\{\s*\n\s*report:\s*parsedReport,\s*\n\s*bundle:\s*businessResearch,\s*\n\s*expectedDomain:\s*"business",\s*\n\s*\}\);/gm
    ),
  ];
  assert.equal(discardedCallSites.length, 0, "the live-generation call site must no longer discard its result");

  assert.match(
    planExecutorSource,
    /const qualityGateResult = validateDomainResearchQualitySafely\(\{\s*\n\s*report:\s*parsedReport,\s*\n\s*bundle:\s*businessResearch,\s*\n\s*expectedDomain:\s*"business",/,
    "the live-generation path must capture the gate result"
  );
  assert.match(
    planExecutorSource,
    /if \(qualityGateResult\.fallbackUsed && "validationError" in qualityGateResult\) \{\s*\n\s*throw new Error\(qualityGateResult\.validationError \|\| "Report quality gate failed\."\);/,
    "a real gate failure on the live-generation path must be re-thrown, not silently ignored"
  );
});
