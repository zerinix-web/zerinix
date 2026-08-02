import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crossValidateEvidence } from "../app/lib/decision-intelligence/evidence-engine.ts";
import { getDomainProfile } from "../app/lib/decision-intelligence/profiles.ts";
import { buildDecisionResearchPlan } from "../app/lib/decision-intelligence/research-plan.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const intent = {
  primary: "investment_decision",
  secondary: ["real_estate"],
  confidence: 95,
  rationale: ["Property investment request"],
};

const propertyFacts = [
  ["province", "Hatay"],
  ["district", "Defne"],
  ["neighborhood", "Dursunlu"],
  ["locality", "Tamurcu"],
  ["block", "1517"],
  ["parcel", "1"],
  ["property_type", "Ağaçlı Tarla"],
  ["parcel_size", "6,364.62 m²"],
].map(([field, value]) => ({
  field,
  value,
  source: "IMG_5412.PNG",
  confidence: 95,
  category: "Verified Asset",
  verified: true,
  estimated: false,
  missing: false,
}));

test("exact Turkish property entities propagate into every research query", () => {
  const tasks = buildDecisionResearchPlan({
    profile: getDomainProfile("real_estate"),
    intent,
    facts: propertyFacts,
    prompt: "bu arsaya yatırım yapmak istiyorum",
  });

  for (const task of tasks) {
    assert.match(task.query, /Hatay/);
    assert.match(task.query, /Defne/);
    assert.match(task.query, /Dursunlu/);
    assert.match(task.query, /Tamurcu/);
    assert.match(task.query, /block: 1517/);
    assert.match(task.query, /parcel: 1/);
    assert.match(task.query, /Ağaçlı Tarla/);
    assert.match(task.query, /6,364\.62 m²/);
  }
});

test("research task completion requires a usable normalized evidence source", () => {
  const execution = read(
    "app/lib/decision-intelligence/research-execution.ts"
  );
  const contracts = read("app/lib/decision-intelligence/contracts.ts");

  for (const status of [
    "completed_with_evidence",
    "completed_no_evidence",
    "provider_unavailable",
    "failed",
    "timed_out",
    "skipped_with_reason",
  ]) {
    assert.match(contracts, new RegExp(`"${status}"`));
  }
  assert.match(execution, /hasUsableEvidence/);
  assert.match(execution, /completed_no_evidence/);
  assert.match(execution, /sourceUrls/);
  assert.doesNotMatch(contracts, /\|\s*"not_found"/);
  assert.doesNotMatch(contracts, /\|\s*"timeout"/);
});

test("a single weak source cannot yield 67 percent confidence", () => {
  const profile = getDomainProfile("real_estate");
  const checkedAt = new Date().toISOString();
  const evidence = [
    {
      id: "R1",
      field: "location",
      title: "Weak listing",
      summary: "Listing says Hatay",
      value: "Hatay",
      source: "Listing",
      url: "https://example.com/listing",
      provider: "web",
      confidence: 45,
      official: false,
      verified: true,
      publishedDate: "",
      lastChecked: checkedAt,
      supportingData: [],
      category: "External Research",
    },
  ];
  const validation = crossValidateEvidence({
    profile,
    evidence,
    facts: propertyFacts,
    unresolvedFields: profile.criticalEvidence.filter(
      (field) => field !== "location" && field !== "parcel_size"
    ),
  });

  assert.ok(validation.confidence < 67);
});

test("one source cannot create a false verified-source conflict", () => {
  const profile = getDomainProfile("real_estate");
  const checkedAt = new Date().toISOString();
  const shared = {
    title: "One source",
    summary: "One source",
    source: "One source",
    url: "https://example.gov.tr/plan",
    provider: "web",
    confidence: 80,
    official: true,
    verified: true,
    publishedDate: "",
    lastChecked: checkedAt,
    supportingData: [],
    category: "Official Source",
  };
  const validation = crossValidateEvidence({
    profile,
    evidence: [
      { ...shared, id: "R1", field: "zoning", value: "Tarla" },
      { ...shared, id: "R2", field: "zoning", value: "Konut" },
    ],
    facts: [],
    unresolvedFields: profile.criticalEvidence,
  });

  assert.equal(validation.conflicts.length, 0);
});

test("one uploaded file keeps one source identity across extraction stages", () => {
  const profile = getDomainProfile("real_estate");
  const base = {
    field: "location",
    provider: "uploaded_asset",
    confidence: 90,
    official: false,
    verified: true,
    publishedDate: "",
    lastChecked: new Date().toISOString(),
    supportingData: [],
    category: "Verified Asset",
  };
  const validation = crossValidateEvidence({
    profile,
    evidence: [
      {
        ...base,
        id: "A1",
        title: "IMG_5412.PNG",
        source: "IMG_5412.PNG",
        summary: "Konum",
        value: "Hatay > Defne > Dursunlu",
        url: "",
      },
      {
        ...base,
        id: "A2",
        title: "Uploaded asset IMG_5412.PNG",
        source: "uploaded asset IMG_5412.PNG",
        summary: "Konum ayrıntısı",
        value: "Hatay, Defne, Dursunlu, Tamurcu",
        url: "",
      },
    ],
    facts: [],
    unresolvedFields: profile.criticalEvidence,
  });

  assert.equal(validation.conflicts.length, 0);
});

test("location hierarchy overlap is corroboration, not a source conflict", () => {
  const profile = getDomainProfile("real_estate");
  const checkedAt = new Date().toISOString();
  const evidence = [
    {
      id: "A1",
      field: "location",
      title: "IMG_5412.PNG",
      summary: "Uploaded location",
      value: "Hatay / Defne / Dursunlu / Tamurcu",
      source: "IMG_5412.PNG",
      url: "",
      provider: "uploaded_asset",
      confidence: 95,
      official: false,
      verified: true,
      publishedDate: "",
      lastChecked: checkedAt,
      supportingData: [],
      category: "Verified Asset",
    },
    {
      id: "R1",
      field: "location",
      title: "Dursunlu Mahallesi",
      summary: "Dursunlu is in Defne",
      value: "Dursunlu Mahallesi, Defne, Hatay",
      source: "Local map",
      url: "https://example.com/dursunlu",
      provider: "web",
      confidence: 60,
      official: false,
      verified: true,
      publishedDate: "",
      lastChecked: checkedAt,
      supportingData: [],
      category: "External Research",
    },
  ];
  const validation = crossValidateEvidence({
    profile,
    evidence,
    facts: propertyFacts,
    unresolvedFields: profile.criticalEvidence.filter(
      (field) => field !== "location"
    ),
  });

  assert.equal(validation.conflicts.length, 0);
  assert.ok(validation.corroboratedFields.includes("location"));
});

test("genuinely different locations still create a source conflict", () => {
  const profile = getDomainProfile("real_estate");
  const checkedAt = new Date().toISOString();
  const evidence = [
    {
      id: "A1",
      field: "location",
      title: "IMG_5412.PNG",
      summary: "Uploaded location",
      value: "Hatay / Defne / Dursunlu",
      source: "IMG_5412.PNG",
      url: "",
      provider: "uploaded_asset",
      confidence: 95,
      official: false,
      verified: true,
      publishedDate: "",
      lastChecked: checkedAt,
      supportingData: [],
      category: "Verified Asset",
    },
    {
      id: "R1",
      field: "location",
      title: "Different location",
      summary: "Different location",
      value: "İstanbul / Kadıköy",
      source: "External map",
      url: "https://example.com/kadikoy",
      provider: "web",
      confidence: 80,
      official: false,
      verified: true,
      publishedDate: "",
      lastChecked: checkedAt,
      supportingData: [],
      category: "External Research",
    },
  ];
  const validation = crossValidateEvidence({
    profile,
    evidence,
    facts: propertyFacts,
    unresolvedFields: profile.criticalEvidence.filter(
      (field) => field !== "location"
    ),
  });

  assert.equal(validation.conflicts.length, 1);
  assert.equal(validation.conflicts[0]?.field, "location");
});

test("research provider evidence is restricted to provider-returned source URLs", () => {
  const research = read("app/lib/ai/domain-research.ts");
  const extraction = read("app/lib/ai/research-entity-extraction.ts");

  assert.match(research, /collectProviderSourceUrls/);
  assert.match(research, /collectProviderSearchQueries/);
  assert.match(research, /providerSourceUrls\.has/);
  assert.match(research, /isGenericSourceHomepage/);
  assert.match(research, /!field \|\|\s*!claim \|\|\s*!evidenceValue/);
  assert.match(
    research,
    /candidate\) => candidate\.field === normalizedItem\.field/
  );
  assert.match(research, /const uploadedEvidence: DecisionEvidence\[\]/);
  assert.match(research, /const extractedFacts = entityExtraction\.facts\.filter/);
  assert.match(research, /exactParcelEvidenceFields/);
  assert.match(research, /geographicEvidenceFields/);
  assert.match(research, /getEvidenceEntityMatch/);
  assert.match(research, /sourceIdentityText/);
  assert.match(research, /buildEvidenceSearchText/);
  assert.match(research, /specificGeographicMatch/);
  assert.match(research, /fieldSourceSignals/);
  assert.match(research, /isOfficialGovernmentSource/);
  assert.match(research, /tool_choice:\s*\{\s*type:\s*"web_search_preview"\s*\}/);
  assert.match(research, /\[research-engine\] \$\{event\}/);
  assert.match(research, /requiredResearchCompletion/);
  assert.match(extraction, /parcel_size/);
  assert.match(extraction, /IMG_5412|uploaded filename|source/i);
  assert.match(extraction, /rawConfidence > 0 && rawConfidence <= 1/);
});

test("valid structured evidence is retained when the provider reports an incomplete status", () => {
  const research = read("app/lib/ai/domain-research.ts");

  assert.doesNotMatch(
    research,
    /response\.status !== "completed" \|\| !response\.output_text\.trim\(\)/
  );
  assert.match(research, /if \(!response\.output_text\.trim\(\)\)/);
  assert.match(research, /parsed = JSON\.parse\(response\.output_text\)/);
  assert.match(
    research,
    /successfulProviderCalls \+= 1;\s*responseIds\.push\(response\.id\)/
  );
});

test("the real provider path is server-configurable and missing credentials are user-safe", () => {
  const research = read("app/lib/ai/domain-research.ts");
  const tavilyConfig = read(
    "app/lib/research-providers/tavily/config.mjs"
  );
  const planRoute = read("app/lib/report-jobs/plan-executor.ts");

  assert.doesNotMatch(
    research,
    /process\.env\.NODE_ENV !== "production"[\s\S]*ENABLE_TAVILY_RESEARCH/
  );
  assert.doesNotMatch(
    tavilyConfig,
    /productionBlocked = nodeEnvironment === "production"/
  );
  assert.match(
    planRoute,
    /Araştırma servisi şu anda kullanılamıyor\./
  );
});

test("research exhausts ordered source stages and configured alternatives before stopping", () => {
  const research = read("app/lib/ai/domain-research.ts");

  for (const stage of [
    "official_government",
    "authoritative_public",
    "commercial_market",
    "regional_local",
  ]) {
    assert.match(research, new RegExp(stage));
  }

  assert.doesNotMatch(research, /usableExternalEvidence\.length >= 3/);
  assert.match(research, /Do not treat the absence of results in an earlier stage as permission to skip this stage/);
  assert.match(research, /createTavilyResearchCoordinator/);
  assert.match(research, /tavily-search provider_unavailable/);
  assert.match(
    research,
    /researchCompleted:\s*requiredResearchCompletion === 100[\s\S]*usableExternalEvidenceCount > 0/
  );
  assert.match(
    research,
    /usableEvidenceCount === 0[\s\S]*verifiedSources === 0[\s\S]*confidenceScore <[\s\S]*"clarification"/
  );
  assert.match(
    research,
    /evidenceSupportedOutput === "clarification"[\s\S]*"preliminary_report"/
  );
});

test("every task receives multiple entity-rich queries at every source stage", () => {
  const research = read("app/lib/ai/domain-research.ts");

  assert.match(research, /function buildTaskStageQueries/);
  assert.match(research, /const entities = facts/);
  assert.match(research, /const geography = facts/);
  assert.match(research, /fieldSynonyms/);
  assert.match(research, /Execute multiple query variants for every task/);
  assert.match(research, /stageQueries\.get\(task\.id\)/);
});

test("evidence quality rewards authority and exact entity specificity", () => {
  const research = read("app/lib/ai/domain-research.ts");

  assert.match(research, /function scoreResearchEvidence/);
  assert.match(research, /authorityScore/);
  assert.match(research, /specificityScore/);
  assert.match(research, /provenanceScore/);
  assert.match(research, /evaluateAggregateResearchEvidence/);
  assert.match(research, /right\.qualityScore/);
});

test("unresolved research retains provider, query, reason, and next-provider provenance", () => {
  const contracts = read("app/lib/decision-intelligence/contracts.ts");
  const research = read("app/lib/ai/domain-research.ts");
  const planRoute = read("app/lib/report-jobs/plan-executor.ts");

  for (const field of [
    "stage",
    "provider",
    "query",
    "reason",
    "evidenceCount",
    "nextProvider",
  ]) {
    assert.match(contracts, new RegExp(`${field}:`));
  }
  assert.match(research, /attemptsByTask/);
  assert.match(research, /attempt provenance unavailable/);
  assert.match(planRoute, /Providers and queries:/);
  assert.match(planRoute, /attempt\.nextProvider/);
});
