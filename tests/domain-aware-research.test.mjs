import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  classifyReportDomain,
} from "../app/lib/report-engine/domain.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const asset = (name, type, textContent = "") => ({
  name,
  type,
  size: textContent.length,
  textContent,
  dataUrl: "",
});

test("domain classification covers the required decision inputs", () => {
  assert.equal(
    classifyReportDomain("bu arsaya yatırım yapmak istiyorum", [
      asset("tapu.png", "image/png", "Ada 12 parsel 34"),
    ]),
    "real_estate"
  );
  assert.equal(
    classifyReportDomain("Review termination and indemnity", [
      asset("contract.pdf", "application/pdf"),
    ]),
    "legal"
  );
  assert.equal(
    classifyReportDomain("Forecast cash flow from this workbook", [
      asset(
        "financials.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ),
    ]),
    "finance"
  );
  assert.equal(
    classifyReportDomain("Assess this company website and its competitors https://example.com"),
    "business"
  );
  assert.equal(
    classifyReportDomain("Build a business plan for a logistics company"),
    "business"
  );
});

test("research plans and quality gates cover every required safeguard", () => {
  const research = read("app/lib/ai/domain-research.ts");

  assert.match(research, /field: "zoning"[\s\S]*"municipality"/);
  assert.match(research, /field: "governing_law"[\s\S]*"official legislation"/);
  assert.match(research, /field: "macro_inputs"[\s\S]*"central bank"/);
  assert.match(research, /field: "accounting_standard"[\s\S]*"IFRS Foundation"/);
  assert.match(research, /field: "standards"[\s\S]*"standards body"/);
  assert.match(research, /field: "supplier_verification"[\s\S]*"company registry"/);
  assert.match(research, /type: "web_search_preview"/);
  assert.match(research, /unsupported numeric claim/);
  assert.match(research, /material factual claim lacks source or method provenance/);
  assert.match(research, /confident recommendation is not allowed/);
  assert.match(research, /more than 40% of critical decision fields remain Unknown/);
  assert.match(research, /taskResults/);
  assert.match(research, /provider_unavailable/);
  assert.match(research, /completed_no_evidence/);
  assert.match(research, /Access date:/);
  assert.match(research, /Official:/);
});

test("real-estate research covers official, market, hazard, amenity, and geospatial evidence", () => {
  const profiles = read("app/lib/decision-intelligence/profiles.ts");

  for (const expected of [
    "AFAD",
    "DSİ",
    "amenities_projects",
    "regional_development",
    "geospatial_context",
    "official geospatial portal",
    "TÜİK",
    "municipality",
    "comparables",
  ]) {
    assert.match(profiles, new RegExp(expected));
  }
});

test("report routes research first and the renderer supports specialized schemas", () => {
  const planRoute = read("app/lib/report-jobs/plan-executor.ts");
  const marketRoute = read("app/api/market-analysis/route.ts");
  const planner = read("components/Planner.tsx");

  assert.match(
    planRoute,
    /runDomainAwareResearch[\s\S]*Completed domain-aware research/
  );
  assert.match(
    planRoute,
    /reportDomain === "legal"[\s\S]*generateSpecializedDomainReport/
  );
  assert.match(
    marketRoute,
    /runDomainAwareResearch[\s\S]*Research is already complete/
  );
  assert.match(planner, /getPlanFieldsForDomain\(reportDomain\)/);
  assert.match(planner, /subjectIdentification/);
});

test("research has a hard deadline and malformed evidence is discarded per item", () => {
  const research = read("app/lib/ai/domain-research.ts");

  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence generation
  // timeout incident): this outer research-phase cap, the full-report
  // synthesis call's own timeout, and the optional entity-extraction
  // step summed to ~312-327s -- already exceeding the 300s Vercel
  // maxDuration shared by every Market Intelligence trigger path.
  // Reduced with margin so the sum fits; the hard-deadline/Promise.race/
  // degraded-fallback BEHAVIOR this test protects is unchanged.
  assert.match(research, /const hardTimeoutMs = 90_000/);
  assert.match(research, /Promise\.race/);
  assert.match(research, /return createEmergencyResearchFallback\(error\)/);
  assert.match(research, /if \(!item \|\| typeof item !== "object"\) return \[\]/);
  assert.match(research, /isGenericSourceHomepage\(normalizedExternalUrl\)/);
});

test("research execution is bounded, concurrent, cached, and phase-timed", () => {
  const research = read("app/lib/ai/domain-research.ts");
  const planRoute = read("app/lib/report-jobs/plan-executor.ts");

  assert.match(research, /const RESEARCH_CONCURRENCY_LIMIT = 4/);
  // 2026-08-08 cost-optimization pass: this used to hardcode the premium
  // gpt-5.5 tier directly; it's now a named, env-overridable constant
  // defaulting to a cheaper tier (see DOMAIN_RESEARCH_MODEL).
  assert.match(
    research,
    /const researchModel = DOMAIN_RESEARCH_MODEL;/
  );
  assert.match(
    research,
    /export const DOMAIN_RESEARCH_MODEL =\s*\n?\s*process\.env\.AI_RESEARCH_MODEL\?\.trim\(\) \|\| "gpt-5-mini";/
  );
  assert.match(research, /model: researchModel/);
  assert.match(research, /await Promise\.all\(workers\)/);
  // selectedStages (not the flat researchSourceStages constant directly)
  // since research source guidance is now domain-aware -- see
  // getResearchSourceStages/businessResearchSourceStages below.
  assert.match(
    research,
    /mapWithConcurrency\(\s*selectedStages,\s*RESEARCH_CONCURRENCY_LIMIT/
  );
  assert.match(research, /researchRequestCache = new Map/);
  assert.match(research, /tavilyRequestCache = new Map/);
  assert.match(research, /RESEARCH_PROVIDER_TIMEOUT_MS = 120_000/);
  assert.match(research, /ENTITY_EXTRACTION_TIMEOUT_MS = 15_000/);
  assert.match(
    research,
    /input: buildAnalysisProviderInput\(\s*strategyInput,\s*assets/
  );
  assert.match(research, /entityExtractionMs/);
  assert.match(research, /researchPlanningMs/);
  assert.match(research, /researchExecutionMs/);

  assert.match(planRoute, /REAL_ESTATE_PIPELINE_BUDGET_MS = 58_000/);
  assert.match(planRoute, /FULL_REPORT_OPENAI_TIMEOUT_MS = 24_000/);
  assert.doesNotMatch(planRoute, /FULL_REPORT_OPENAI_TIMEOUT_MS = 180_000/);
  assert.match(planRoute, /remainingPipelineBudgetMs/);
  assert.match(planRoute, /providerTimeoutMs/);
  assert.match(planRoute, /createGroundedBusinessTimeoutFallback/);
  assert.match(planRoute, /createGroundedDomainTimeoutFallback/);
  for (const phase of [
    "Asset Extraction",
    "Entity Extraction",
    "Research Planning",
    "Research Execution",
    "Report Generation",
    "PDF Preparation",
    "Total",
  ]) {
    assert.match(planRoute, new RegExp(phase));
  }
});
