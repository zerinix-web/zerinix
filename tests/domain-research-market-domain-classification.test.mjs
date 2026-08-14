import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crossValidateEvidence } from "../app/lib/decision-intelligence/evidence-engine.ts";
import { getDomainProfile } from "../app/lib/decision-intelligence/profiles.ts";

const domainResearchSource = readFileSync(
  new URL("../app/lib/ai/domain-research.ts", import.meta.url),
  "utf8"
);

function marketEvidenceItem(field, index) {
  return {
    id: `ev_${field}_${index}`,
    field,
    title: `Source ${index} for ${field}`,
    summary: `Verified claim about ${field} from a real market research source.`,
    value: `Concrete ${field} value ${index}`,
    source: "web_search",
    url: `https://example.com/${field}/${index}`,
    provider: "openai_web_search",
    confidence: 85,
    official: false,
    verified: true,
    publishedDate: "2026-01-01",
    lastChecked: new Date().toISOString(),
    supportingData: [],
    category: "External Research",
  };
}

// The exact Market Intelligence evidence fields market-research-planner.ts
// produces (dynamic-research-plan.ts's createMarketIntelligenceSeeds uses
// the same vocabulary). None of these are real-estate fields.
const marketFields = [
  "vendor_discovery",
  "competitors",
  "market_demand",
  "market_size",
  "industry_structure",
  "pricing_models",
  "product_evidence",
  "company_evidence",
  "academic_evidence",
  "news_evidence",
  "regional_benchmark",
  "global_benchmark",
];

test("root cause reproduced: real market evidence is entirely discarded when cross-validated against the real_estate domain profile", () => {
  const evidence = marketFields.map((field, index) => marketEvidenceItem(field, index));
  const result = crossValidateEvidence({
    profile: getDomainProfile("real_estate"),
    evidence,
    facts: [],
    unresolvedFields: [],
  });

  assert.equal(
    result.evidence.length,
    0,
    "every market-field evidence item should be recognized by NEITHER domain's field list when misclassified as real_estate"
  );
  // This is exactly what a misclassified domain looks like downstream:
  // every attempted field ends up unresolved, and the unresolved list is
  // real-estate's own critical-evidence vocabulary, not the market fields
  // that were actually researched.
  const unresolved = new Set(result.unresolvedFields);
  assert.ok(unresolved.has("asset_identification") || result.unresolvedFields.length === 0);
});

test("fix verified: the same real market evidence is recognized once cross-validated against the business domain profile", () => {
  const evidence = marketFields.map((field, index) => marketEvidenceItem(field, index));
  const result = crossValidateEvidence({
    profile: getDomainProfile("business"),
    evidence,
    facts: [],
    unresolvedFields: [],
  });

  assert.ok(
    result.evidence.length > 0,
    "at least the business profile's recognized market fields (company_evidence, market_demand, competitors) must survive"
  );
  const recognizedFields = new Set(result.evidence.map((item) => item.field));
  assert.ok(recognizedFields.has("market_demand"));
  assert.ok(recognizedFields.has("competitors"));
});

test("createDomainResearchPlan is selectedMode-aware: Market Intelligence forces domain business / decisionType market_entry instead of the prompt-text classifier", () => {
  assert.match(
    domainResearchSource,
    /export function createDomainResearchPlan\(\s*\n\s*prompt: string,\s*\n\s*assets: readonly AnalysisAsset\[\] = \[\],\s*\n\s*onPhase\?: DecisionIntelligencePhaseLogger,\s*\n\s*seedFacts: ExtractedFact\[\] = \[\],\s*\n\s*selectedMode\?: unknown/
  );
  assert.match(
    domainResearchSource,
    /const isMarketIntelligence = selectedMode === "market";\s*\n\s*const domain: ResearchDomain = isMarketIntelligence\s*\n\s*\? "business"/
  );
  assert.match(
    domainResearchSource,
    /const decisionType: ResearchDecisionType = isMarketIntelligence\s*\n\s*\? "market_entry"/
  );
  assert.match(
    domainResearchSource,
    /const legacyResearchPlan = createDomainResearchPlan\(\s*\n\s*prompt,\s*\n\s*assets,\s*\n\s*onPhase,\s*\n\s*entityExtraction\.facts,\s*\n\s*selectedMode\s*\n\s*\);/
  );
});
