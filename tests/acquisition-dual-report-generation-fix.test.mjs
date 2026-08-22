import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL FIX -- prevent dual report generation for specialized report
// types.
//
// Auditing input -> report classification -> mode selection -> Planner
// state -> report builder selection -> streaming renderer -> PDF
// generator found the backend generator dispatch
// (plan-executor.ts's executePlanRequestInner) was ALREADY structurally
// exclusive: a strict if/else-if chain of early `return`s, so only one
// generator can ever run per request -- there was never a code path where
// both the Business Plan and Acquisition Due Diligence generators could
// both initialize.
//
// The real gap was downstream, on the client: components/Planner.tsx
// decided the report's identity (title, output-field shape used to parse
// the worker's persisted sections back out, and therefore what the
// streaming renderer displays) from its OWN pre-fetch classification --
// in "chat" mode that depends on the LLM-based /api/understanding call's
// expertiseProfile.domain, which can disagree with the domain the worker
// actually generated under (worker.ts's own inferDomain, which reads the
// generator's own authoritative reportDomain stream event). Every report
// schema in this codebase deliberately shares zero field names with any
// other, so a wrong guess meant either the wrong title rendered over
// content the client couldn't parse, or the report failed outright.
//
// Fixed by extracting worker.ts's own "distinguishing fields" domain-
// inference technique into a new shared, isomorphic module
// (app/lib/report-engine/domain-inference.ts) and having Planner.tsx
// self-correct its guessed report identity from the worker's own
// persisted section field names before rendering -- the client now trusts
// the same authoritative signal the worker already trusts, instead of
// its own earlier guess.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

const { inferReportDomainFromFieldNames } = await import(
  "../app/lib/report-engine/domain-inference.ts"
);
const { acquisitionAnalysisFields } = await import(
  "../app/lib/report-engine/prompts/acquisition-analysis.ts"
);
const { realEstateFields } = await import(
  "../app/lib/report-engine/prompts/real-estate.ts"
);
const { domainAnalysisFields } = await import(
  "../app/lib/report-engine/prompts/domain-analysis.ts"
);
const { planFields } = await import("../app/lib/report-engine/prompts/plan.ts");

const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

async function importReportUtils() {
  const sourcePath = join(repoRoot, "app/dashboard/report-utils.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-investment-score"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-investment-score.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-section-normalization"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-section-normalization.ts")).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/acquisition-presentation"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/acquisition-presentation.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-utils-"));
  const outPath = join(dir, "report-utils.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { normalizeReport } = await importReportUtils();

// --- 1. Acquisition prompt creates exactly one report type (backend) -----
// ---    -- the dispatcher is a strict, exclusive if/else-if chain -------

test("plan-executor.ts's dispatcher returns immediately from the acquisition branch -- generateAcquisitionDueDiligenceReport is the terminal call, nothing after it in the function can also run", () => {
  assert.match(
    planExecutorSource,
    /if \(reportDomain === "acquisition"\) \{\s*\n\s*return generateAcquisitionDueDiligenceReport\(\{/
  );
});

test("plan-executor.ts's dispatcher checks 'real_estate' and 'acquisition' as separate, mutually exclusive early-return branches -- never a shared/combined condition that could call two generators", () => {
  assert.match(
    planExecutorSource,
    /if \(reportDomain === "real_estate"\) \{\s*\n\s*return generateRealEstateInvestmentReport\(\{/
  );
  assert.match(
    planExecutorSource,
    /if \(reportDomain === "acquisition"\) \{\s*\n\s*return generateAcquisitionDueDiligenceReport\(\{/
  );

  const realEstateIndex = planExecutorSource.indexOf('if (reportDomain === "real_estate") {');
  const acquisitionIndex = planExecutorSource.indexOf('if (reportDomain === "acquisition") {');
  assert.ok(realEstateIndex > -1 && acquisitionIndex > -1);
  assert.notEqual(realEstateIndex, acquisitionIndex);
});

test("plan-executor.ts: the acquisition dispatch branch appears BEFORE the legacy Business Plan per-field code path, and returns unconditionally -- an acquisition request can never fall through into business_plan generation", () => {
  const acquisitionBranchIndex = planExecutorSource.indexOf(
    'if (reportDomain === "acquisition") {\n      return generateAcquisitionDueDiligenceReport({'
  );
  const legacyBusinessPlanFieldIndex = planExecutorSource.indexOf(
    "const fieldConfig = planPrompts[reportField];"
  );
  assert.ok(acquisitionBranchIndex > -1, "acquisition dispatch branch not found");
  assert.ok(legacyBusinessPlanFieldIndex > -1, "legacy business-plan field path not found");
  assert.ok(
    acquisitionBranchIndex < legacyBusinessPlanFieldIndex,
    "acquisition dispatch branch must appear before the legacy business-plan field code so a `return` inside it always executes first"
  );
});

test("plan-executor.ts: reportDomain is computed exactly once per request, from resolveReportDomainForSelectedMode -- no second, independent domain decision exists that could pick a different generator for the same request", () => {
  const occurrences = [
    ...planExecutorSource.matchAll(/const reportDomain = resolveReportDomainForSelectedMode\(/g),
  ];
  assert.equal(
    occurrences.length,
    1,
    `expected exactly one reportDomain computation in the dispatcher, found ${occurrences.length}`
  );
});

// --- 2. Business Plan generator is not called for an acquisition request -

test("plan-executor.ts: the acquisition dispatch branch's request shape passes no 'field' that could route into the legacy per-field Business Plan handler -- it calls the dedicated generator directly with the full request context", () => {
  const fnMatch = /if \(reportDomain === "acquisition"\) \{\s*\n\s*return generateAcquisitionDueDiligenceReport\(\{[\s\S]*?\n\s*\}\);\s*\n\s*\}/.exec(
    planExecutorSource
  );
  assert.ok(fnMatch, "acquisition dispatch block not found");
  assert.doesNotMatch(fnMatch[0], /field:\s*reportField/, "acquisition dispatch must never forward the legacy per-field routing key");
});

// --- 3. UI never renders mixed report types --------------------------------

test("inferReportDomainFromFieldNames maps acquisition's own fields to 'acquisition', never 'business'", () => {
  assert.equal(inferReportDomainFromFieldNames(acquisitionAnalysisFields), "acquisition");
  assert.equal(inferReportDomainFromFieldNames(["strategicFit", "valuationAnalysis"]), "acquisition");
});

test("inferReportDomainFromFieldNames maps real_estate's own fields to 'real_estate'", () => {
  assert.equal(inferReportDomainFromFieldNames(realEstateFields), "real_estate");
});

test("inferReportDomainFromFieldNames maps the shared specialized-domain schema (legal/finance/accounting/operations/procurement) to 'legal'", () => {
  assert.equal(inferReportDomainFromFieldNames(domainAnalysisFields), "legal");
});

test("inferReportDomainFromFieldNames maps Business Plan's own fields to 'business'", () => {
  assert.equal(inferReportDomainFromFieldNames(planFields), "business");
});

test("inferReportDomainFromFieldNames never returns 'business' when even one acquisition-distinguishing field is present, regardless of what else is mixed in", () => {
  const domain = inferReportDomainFromFieldNames(["someUnknownField", "targetCompanyOverview", "anotherUnknownField"]);
  assert.equal(domain, "acquisition");
});

test("inferReportDomainFromFieldNames falls back to 'business' (never fabricates a specialized domain) for an empty or entirely unrecognized field list", () => {
  assert.equal(inferReportDomainFromFieldNames([]), "business");
  assert.equal(inferReportDomainFromFieldNames(["totallyUnknownField"]), "business");
});

test("Planner.tsx imports and uses inferReportDomainFromFieldNames to self-correct the report identity from the worker's own persisted sections, rather than trusting only its own pre-fetch guess (drift check)", () => {
  assert.match(
    plannerSource,
    /import \{ inferReportDomainFromFieldNames \} from "@\/app\/lib\/report-engine\/domain-inference";/
  );
  assert.match(plannerSource, /const correctedDomain = inferReportDomainFromFieldNames\(persistedFieldNames\);/);
});

test("Planner.tsx: outputFields/reportTitle are reassignable (let, not const) so the self-correction can actually take effect on the live report identity", () => {
  assert.match(plannerSource, /let outputFields = localizeReportFields\(/);
  assert.match(plannerSource, /let reportTitle =\s*\n\s*requestedMode === "market"/);
  assert.doesNotMatch(plannerSource, /const outputFields = localizeReportFields\(/);
});

test("Planner.tsx: the domain self-correction runs BEFORE the loop that extracts section content from the persisted report -- ordering matters, a correction applied too late would use the wrong field/title lookup", () => {
  const correctionIndex = plannerSource.indexOf("const correctedDomain = inferReportDomainFromFieldNames(persistedFieldNames);");
  const extractionLoopIndex = plannerSource.indexOf("for (const { field, title } of outputFields) {");
  assert.ok(correctionIndex > -1 && extractionLoopIndex > -1);
  assert.ok(
    correctionIndex < extractionLoopIndex,
    "self-correction must run before the section-extraction loop that depends on outputFields"
  );
});

test("Planner.tsx: the self-correction is scoped to non-market requests -- Market Intelligence has its own dedicated pipeline and field schema, out of scope for this field-based fallback", () => {
  const fnMatch = /if \(requestedMode !== "market"\) \{[\s\S]*?const correctedDomain = inferReportDomainFromFieldNames[\s\S]*?\n\s*\}\s*\n\s*\}/.exec(
    plannerSource
  );
  assert.ok(fnMatch, "self-correction block not scoped to requestedMode !== \"market\"");
});

// --- 4. PDF export uses only the acquisition template ---------------------

test("report-utils.ts: a worker-persisted acquisition report (report_type='acquisition_due_diligence_analysis') normalizes to type 'Acquisition Due Diligence Report', never 'Business Plan'", () => {
  const report = normalizeReport({
    id: "r1",
    report_type: "acquisition_due_diligence_analysis",
    status: "completed",
    sections: [
      { field: "valuationAnalysis", title: "Valuation Analysis", content: "EV/ARR of 5.0x." },
    ],
  });
  assert.equal(report.type, "Acquisition Due Diligence Report");
  assert.notEqual(report.type, "Business Plan");
});

test("ReportPdfButton.tsx: isAcquisitionReport is derived from the persisted report's own saved type or its actual section field content -- never from a live/guessed value", () => {
  const match = /const isAcquisitionReport =\s*\n\s*report\.type === "Acquisition Due Diligence Report" \|\|\s*\n\s*report\.sections\.some\(\(section\) => section\.field === "valuationAnalysis"\);/;
  assert.match(pdfButtonSource, match);
});

test("ReportPdfButton.tsx only ever renders from an already-persisted `report` prop (loaded from the reports table), never from a live streaming/guessed report-identity variable -- the PDF template selection is structurally immune to the client's pre-fetch domain guess", () => {
  assert.doesNotMatch(pdfButtonSource, /resolveReportDomainForSelectedMode/);
  assert.doesNotMatch(pdfButtonSource, /classifyReportDomain/);
});

// --- 5. The isolation guard and worker.ts's authoritative domain --------
// ---    inference are both untouched by this fix -----------------------

test("worker.ts's inferDomain still treats the report event stream's own reportDomain chunk as the primary source of truth, ahead of the request payload -- untouched by this fix (drift check)", () => {
  const workerSource = readFileSync(
    new URL("../app/lib/report-jobs/worker.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    workerSource,
    /const eventDomain = events\.map\(\(event\) => readString\(event\.reportDomain\)\)\.find\(Boolean\);/
  );
  assert.match(workerSource, /const candidate = eventDomain \|\| payloadDomain;/);
});

test("report-isolation-validator.ts is not imported by the new domain-inference module -- this fix never touches the isolation guard, only the client's report-identity bookkeeping (drift check)", () => {
  const domainInferenceSource = readFileSync(
    new URL("../app/lib/report-engine/domain-inference.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(domainInferenceSource, /^import .*report-isolation-validator/m);
});
