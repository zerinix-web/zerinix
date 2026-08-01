import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { crossValidateEvidence } from "../app/lib/decision-intelligence/evidence-engine.ts";
import { detectDecisionIntent } from "../app/lib/decision-intelligence/intent.ts";
import {
  detectDecisionDomain,
  domainProfiles,
  getDomainProfile,
} from "../app/lib/decision-intelligence/profiles.ts";
import { buildDecisionResearchPlan } from "../app/lib/decision-intelligence/research-plan.ts";
import { executeDecisionResearch } from "../app/lib/decision-intelligence/research-execution.ts";
import { analyzeDecisionRisks } from "../app/lib/decision-intelligence/risk-engine.ts";
import { reasonAboutDecisionRule } from "../app/lib/decision-intelligence/reasoning-engine.ts";
import { runFailSafeDecisionPhase } from "../app/lib/decision-intelligence/fail-safe.ts";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const emptyIntent = {
  primary: "strategic_advisory",
  secondary: [],
  confidence: 55,
  rationale: [],
};

test("intent and domain detection support multiple intents and specific industries", () => {
  const detected = detectDecisionIntent(
    "Bu arsa için yatırım, değerleme ve risk analizi yap"
  );

  assert.equal(detected.primary, "investment_decision");
  assert.ok(detected.secondary.includes("real_estate"));
  assert.ok(detected.secondary.includes("financial_analysis"));
  assert.ok(detected.secondary.includes("risk_assessment"));
  assert.ok(detected.confidence > 68);
  assert.equal(
    detectDecisionDomain("Factory capacity and production line investment"),
    "manufacturing"
  );
  assert.equal(
    detectDecisionDomain("Clinical patient safety and drug interaction"),
    "healthcare"
  );
  assert.equal(
    detectDecisionDomain("Tapu parsel imar yatırım değerlendirmesi"),
    "real_estate"
  );
});

test("every domain profile owns research, evidence, rules, risk, and a template", () => {
  for (const [id, profile] of Object.entries(domainProfiles)) {
    assert.equal(profile.id, id);
    assert.ok(profile.criticalEvidence.length > 0);
    assert.ok(profile.decisionRules.length > 0);
    assert.ok(profile.riskModel.length > 0);
    assert.ok(profile.reportTemplate.length > 0);
    assert.ok(Array.isArray(profile.researchRequirements));
  }

  for (const id of [
    "real_estate",
    "healthcare",
    "legal",
    "finance",
    "manufacturing",
    "technology",
    "ecommerce",
    "restaurant",
    "construction",
    "agriculture",
    "logistics",
    "energy",
    "education",
    "hospitality",
  ]) {
    assert.ok(getDomainProfile(id).researchRequirements.length > 0);
  }
});

test("research planning produces provider-neutral structured tasks", () => {
  const profile = getDomainProfile("real_estate");
  const tasks = buildDecisionResearchPlan({
    profile,
    intent: emptyIntent,
    facts: [
      {
        field: "parcel",
        value: "34",
        source: "tapu.png",
        confidence: 90,
        category: "Verified Asset",
        verified: true,
        estimated: false,
        missing: false,
      },
    ],
    prompt: "Bu arsaya yatırım yapmak istiyorum",
  });

  assert.ok(tasks.length >= 6);
  assert.ok(tasks.every((task) => task.id && task.reason && task.query));
  assert.ok(tasks.every((task) => task.provider === "auto"));
  assert.ok(tasks.every((task) => task.status === "skipped_with_reason"));
  assert.ok(tasks.some((task) => task.field === "zoning" && task.required));
});

test("evidence cross-validation exposes agreement, conflict, and uncertainty", () => {
  const profile = getDomainProfile("real_estate");
  const now = new Date().toISOString();
  const evidence = [
    {
      id: "E1",
      field: "location",
      title: "Registry",
      summary: "Location",
      value: "İzmir",
      source: "Registry",
      url: "https://example.gov/1",
      provider: "web",
      confidence: 90,
      official: true,
      verified: true,
      publishedDate: "",
      lastChecked: now,
      supportingData: [],
      category: "Official Source",
    },
    {
      id: "E2",
      field: "location",
      title: "Municipality",
      summary: "Location",
      value: "İzmir",
      source: "Municipality",
      url: "https://example.gov/2",
      provider: "web",
      confidence: 88,
      official: true,
      verified: true,
      publishedDate: "",
      lastChecked: now,
      supportingData: [],
      category: "Official Source",
    },
    {
      id: "E3",
      field: "zoning",
      title: "Plan",
      summary: "Zoning",
      value: "Residential",
      source: "Municipality",
      url: "https://example.gov/3",
      provider: "web",
      confidence: 92,
      official: true,
      verified: true,
      publishedDate: "",
      lastChecked: now,
      supportingData: [],
      category: "Official Source",
    },
    {
      id: "E4",
      field: "zoning",
      title: "Plan note",
      summary: "Zoning",
      value: "Agricultural",
      source: "Planning authority",
      url: "https://example.gov/4",
      provider: "web",
      confidence: 85,
      official: true,
      verified: true,
      publishedDate: "",
      lastChecked: now,
      supportingData: [],
      category: "Official Source",
    },
  ];
  const validation = crossValidateEvidence({
    profile,
    evidence,
    facts: [],
    unresolvedFields: ["comparables"],
  });

  assert.ok(validation.corroboratedFields.includes("location"));
  assert.equal(validation.conflicts[0].field, "zoning");
  assert.equal(validation.conflicts[0].severity, "high");
  assert.ok(validation.unresolvedFields.includes("comparables"));

  const unresolvedExceptLocation = profile.criticalEvidence.filter(
    (field) => field !== "location"
  );
  const singleSource = crossValidateEvidence({
    profile,
    evidence: evidence.slice(0, 1),
    facts: [],
    unresolvedFields: unresolvedExceptLocation,
  });
  const corroborated = crossValidateEvidence({
    profile,
    evidence: evidence.slice(0, 2),
    facts: [],
    unresolvedFields: unresolvedExceptLocation,
  });
  assert.ok(corroborated.confidence > singleSource.confidence);
});

test("decision scoring is deterministic, explained, and conservative", () => {
  const profile = getDomainProfile("real_estate");
  const validation = crossValidateEvidence({
    profile,
    evidence: [],
    facts: [],
    unresolvedFields: profile.criticalEvidence,
  });
  const risks = analyzeDecisionRisks({ profile, validation });
  const reasoning = reasonAboutDecisionRule({
    rule: profile.decisionRules[0],
    validation,
    researchCompletion: 0,
    verifiedFactRatio: 0,
  });
  const decisionEngine = read(
    "app/lib/decision-intelligence/decision-engine.ts"
  );

  assert.equal(risks.unresolvedCritical.length, profile.criticalEvidence.length);
  assert.ok(risks.risks.length > 0);
  assert.equal(reasoning.impactScore, 50);
  assert.match(reasoning.explanation, /evidence impact/);
  assert.doesNotMatch(decisionEngine, /Math\.random/);
  assert.match(decisionEngine, /impactScore/);
  assert.match(decisionEngine, /Insufficient Evidence/);
  assert.match(decisionEngine, /explanation:/);
});

test("real-estate scoring uses named weighted components and an overall score", () => {
  const profile = getDomainProfile("real_estate");

  assert.deepEqual(
    profile.decisionRules.map((rule) => rule.label),
    [
      "Evidence Quality",
      "Title / Ownership Risk",
      "Zoning Risk",
      "Access and Infrastructure",
      "Environmental and Geotechnical Risk",
      "Market Evidence",
      "Liquidity",
      "Development Potential",
      "Valuation Confidence",
    ]
  );
  assert.ok(
    Math.abs(
      profile.decisionRules.reduce((sum, rule) => sum + rule.weight, 0) - 1
    ) < Number.EPSILON
  );
  const engine = read("app/lib/decision-intelligence/decision-engine.ts");
  assert.match(engine, /label: "Overall Investment Score"/);
  assert.match(engine, /Weighted calculation/);
  assert.match(engine, /Component weight/);
  assert.match(engine, /Proceed Conditionally/);
});

test("research execution is provider modular and returns evidence only", async () => {
  const tasks = buildDecisionResearchPlan({
    profile: getDomainProfile("legal"),
    intent: emptyIntent,
    facts: [],
    prompt: "Review this agreement",
  });
  const result = await executeDecisionResearch({
    providers: [
      {
        id: "mock-government",
        canExecute: () => true,
        async execute() {
          return {
            provider: "ignored-provider-name",
            evidence: [],
            extractedFacts: [],
            attemptedFields: [tasks[0].field, tasks[0].field],
            unresolvedFields: [tasks[1].field],
            taskResults: [
              {
                id: tasks[0].id,
                field: tasks[0].field,
                provider: "",
                status: "completed_with_evidence",
                reason: "Official source found.",
                confidence: 90,
              },
              {
                id: tasks[1].id,
                field: tasks[1].field,
                provider: "",
                status: "completed_no_evidence",
                reason: "Search completed without reliable evidence.",
                confidence: 0,
              },
            ],
            summary: "Evidence only",
            responseId: "mock-1",
          };
        },
      },
    ],
    request: {
      prompt: "Review this agreement",
      language: "English",
      tasks,
    },
  });

  assert.equal(result.provider, "mock-government");
  assert.deepEqual(result.attemptedFields, [tasks[0].field, tasks[1].field]);
  assert.equal(result.taskResults[0].status, "completed_no_evidence");
  assert.equal(result.taskResults[1].status, "completed_no_evidence");
  assert.equal(result.taskResults[0].provider, "mock-government");
  assert.equal(result.evidence.length, 0);
});

test("research execution upgrades completion only when normalized evidence has a source", async () => {
  const tasks = buildDecisionResearchPlan({
    profile: getDomainProfile("legal"),
    intent: emptyIntent,
    facts: [],
    prompt: "Review this agreement",
  }).slice(0, 1);
  const now = new Date().toISOString();
  const result = await executeDecisionResearch({
    providers: [
      {
        id: "mock-official",
        canExecute: () => true,
        async execute() {
          return {
            provider: "mock-official",
            evidence: [
              {
                id: "R1",
                field: tasks[0].field,
                title: "Official legislation",
                summary: "Current legislation",
                value: "Current rule",
                source: "Official Gazette",
                url: "https://example.gov/rule",
                provider: "mock-official",
                confidence: 90,
                official: true,
                verified: true,
                publishedDate: "",
                lastChecked: now,
                supportingData: [],
                category: "Official Source",
              },
            ],
            extractedFacts: [],
            attemptedFields: [tasks[0].field],
            unresolvedFields: [],
            taskResults: [
              {
                id: tasks[0].id,
                field: tasks[0].field,
                provider: "mock-official",
                status: "completed_no_evidence",
                reason: "",
                confidence: 0,
              },
            ],
            summary: "Official evidence",
            responseId: "mock-2",
          };
        },
      },
    ],
    request: {
      prompt: "Review this agreement",
      language: "English",
      tasks,
    },
  });

  assert.equal(result.taskResults[0].status, "completed_with_evidence");
  assert.deepEqual(result.taskResults[0].sourceUrls, [
    "https://example.gov/rule",
  ]);
  assert.equal(result.taskResults[0].officialSourceCount, 1);
});

test("Decision Intelligence phase failures return their legacy fallback", () => {
  const events = [];
  const result = runFailSafeDecisionPhase({
    phase: "Asset Extraction",
    execute() {
      throw new Error("broken extractor");
    },
    fallback: () => [],
    onPhase: (event) => events.push(event),
  });

  assert.deepEqual(result, []);
  assert.deepEqual(
    events.map((event) => event.status),
    ["started", "fallback"]
  );
  assert.match(events[1].error.message, /broken extractor/);
});

test("the active report path inserts decision intelligence before rendering", () => {
  const research = read("app/lib/ai/domain-research.ts");
  const planRoute = read("app/lib/report-jobs/plan-executor.ts");
  const marketRoute = read("app/api/market-analysis/route.ts");

  assert.match(
    research,
    /prepareDecisionIntelligence[\s\S]*executeDecisionResearch[\s\S]*finalizeDecisionIntelligence/
  );
  assert.match(research, /formatDecisionIntelligenceReportContext/);
  assert.match(research, /status !== "completed"/);
  assert.match(research, /incompleteReason=/);
  assert.match(research, /fallbackUsed: true/);
  assert.match(research, /validateDomainResearchQualitySafely/);
  assert.match(planRoute, /runDomainAwareResearch[\s\S]*formatDomainResearchBundle/);
  assert.match(planRoute, /validateDomainResearchQualitySafely/);
  assert.match(
    marketRoute,
    /runDomainAwareResearch[\s\S]*formatDomainResearchBundle/
  );
});
