import test from "node:test";
import assert from "node:assert/strict";
import { assessMarketEvidenceCompleteness } from "../app/lib/ai/market-research-v2/completeness.ts";
import { buildMarketResearchV2Bundle } from "../app/lib/ai/market-research-v2/adapter.ts";
import { executeMarketResearchTask } from "../app/lib/ai/market-research-v2/execute.ts";
import {
  isMarketResearchV2Enabled,
  runMarketIntelligenceResearchV2,
} from "../app/lib/ai/market-research-v2/index.ts";
import { buildMarketResearchTasks } from "../app/lib/ai/market-research-planner.ts";
import { createDynamicReportPlanFallback } from "../app/lib/ai/dynamic-report-plan.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";

function marketTasks(prompt) {
  const expertiseProfile = createExpertiseProfileFallback({ prompt, selectedMode: "market" });
  const reportPlan = createDynamicReportPlanFallback({ expertiseProfile, selectedMode: "market", prompt });
  return buildMarketResearchTasks({ expertiseProfile, reportPlan, prompt });
}

function outcome(task, { verified = [], unverified = [] } = {}) {
  const items = [
    ...verified.map((n, i) => ({
      field: task.field,
      claim: `Claim ${i}`,
      value: `Value ${i}`,
      sourceTitle: `Source ${i}`,
      sourceUrl: `https://example.com/${task.field}/${i}`,
      publisher: "Example Publisher",
      publishedAt: "2026-01-01",
      evidenceType: "credible_market_data",
      confidence: 80,
      verified: true,
    })),
    ...unverified.map((n, i) => ({
      field: task.field,
      claim: `Unverified claim ${i}`,
      value: `Unverified value ${i}`,
      sourceTitle: `Unverified source ${i}`,
      sourceUrl: `https://example.com/${task.field}/unverified/${i}`,
      publisher: "",
      publishedAt: "",
      evidenceType: "other",
      confidence: 20,
      verified: false,
    })),
  ];
  // Mirrors execute.ts's own rule exactly: "completed_with_evidence" means
  // grounded (verified) evidence exists, not merely that some item exists.
  const hasVerifiedEvidence = items.some((item) => item.verified);
  return {
    task,
    items,
    status: hasVerifiedEvidence ? "completed_with_evidence" : "completed_no_evidence",
    reason: hasVerifiedEvidence ? "" : "No citable evidence was found for this field.",
  };
}

test("completeness: fields with only unverified evidence are unresolved and recommendedOutput is clarification when nothing is verified anywhere", () => {
  const [task1, task2] = marketTasks("Market Intelligence report on the Turkish e-commerce logistics market.");
  const outcomes = [outcome(task1, { unverified: [1] }), outcome(task2, {})];
  const completeness = assessMarketEvidenceCompleteness(outcomes);

  assert.deepEqual(completeness.attemptedFields.toSorted(), [task1.field, task2.field].toSorted());
  assert.deepEqual(completeness.unresolvedFields.toSorted(), [task1.field, task2.field].toSorted());
  assert.equal(completeness.recommendedOutput, "clarification");
  assert.equal(completeness.researchCompleted, false);
});

test("completeness: preliminary_report when some but not all required fields are resolved", () => {
  const tasks = marketTasks("Market Intelligence report on the German solar panel installation market.");
  const requiredTasks = tasks.filter((task) => task.required);
  assert.ok(requiredTasks.length >= 2, "fixture assumption: at least two required tasks");

  const outcomes = tasks.map((task, index) =>
    task.required && index === 0
      ? outcome(task, { verified: [1] })
      : outcome(task, {})
  );
  const completeness = assessMarketEvidenceCompleteness(outcomes);

  assert.ok(completeness.requiredResearchCompletion > 0);
  assert.ok(completeness.requiredResearchCompletion < 100);
  assert.equal(completeness.recommendedOutput, "preliminary_report");
});

test("completeness: full_report when every required field has verified evidence", () => {
  const tasks = marketTasks("Market Intelligence report on the Istanbul boutique gym market.");
  const outcomes = tasks.map((task) => outcome(task, { verified: [1] }));
  const completeness = assessMarketEvidenceCompleteness(outcomes);

  assert.equal(completeness.requiredResearchCompletion, 100);
  assert.equal(completeness.recommendedOutput, "full_report");
  assert.equal(completeness.researchCompleted, true);
  assert.equal(completeness.unresolvedFields.length, 0);
});

test("adapter: verified items become 'Verified from external source', unverified become 'Unknown', and the bundle satisfies the DomainResearchBundle contract", () => {
  const [task] = marketTasks("Market Intelligence report on the AI legal software market.");
  const outcomes = [outcome(task, { verified: [1, 2], unverified: [1] })];
  const completeness = assessMarketEvidenceCompleteness(outcomes);
  const bundle = buildMarketResearchV2Bundle({ outcomes, completeness });

  assert.equal(bundle.evidence.length, 3);
  const labels = bundle.evidence.map((item) => item.label).toSorted();
  assert.deepEqual(labels, [
    "Unknown",
    "Verified from external source",
    "Verified from external source",
  ]);
  assert.ok(bundle.evidence.every((item) => item.field === task.field));
  assert.ok(bundle.evidence.every((item) => typeof item.id === "string" && item.id.length > 0));
  assert.equal(bundle.recommendedOutput, completeness.recommendedOutput);
  assert.equal(bundle.fallbackUsed, false);
  assert.equal(bundle.researchAttempted, true);
  assert.ok(bundle.decisionIntelligence);
  assert.equal(bundle.decisionIntelligence.outputMode, completeness.recommendedOutput);
});

test("adapter: authorityLevel is primary only for the explicit official/regulatory evidenceType set", () => {
  const [task] = marketTasks("Market Intelligence report on the French renewable energy market.");
  const outcomes = [
    {
      task,
      items: [
        { field: task.field, claim: "c", value: "v", sourceTitle: "s", sourceUrl: "https://gov.example/x", publisher: "p", publishedAt: "2026-01-01", evidenceType: "official_statistics", confidence: 80, verified: true },
        { field: task.field, claim: "c2", value: "v2", sourceTitle: "s2", sourceUrl: "https://vendor.example/y", publisher: "p2", publishedAt: "2026-01-01", evidenceType: "company_source", confidence: 80, verified: true },
      ],
      status: "completed_with_evidence",
      reason: "",
    },
  ];
  const completeness = assessMarketEvidenceCompleteness(outcomes);
  const bundle = buildMarketResearchV2Bundle({ outcomes, completeness });
  const byUrl = Object.fromEntries(bundle.evidence.map((item) => [item.url, item.authorityLevel]));

  assert.equal(byUrl["https://gov.example/x"], "primary");
  assert.equal(byUrl["https://vendor.example/y"], "secondary");
});

test("execute: a finding whose sourceUrl matches a real web-search citation is verified; one that doesn't is not", async () => {
  const [task] = marketTasks("Market Intelligence report on the US AI accounting software market.");
  const fakeClient = {
    responses: {
      async create() {
        return {
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    field: task.field,
                    findings: [
                      {
                        claim: "Grounded claim",
                        value: "Grounded value",
                        sourceTitle: "Grounded Source",
                        sourceUrl: "https://example.com/grounded",
                        publisher: "Example Inc",
                        publishedAt: "2026-01-01",
                        evidenceType: "credible_market_data",
                        confidence: 90,
                      },
                      {
                        claim: "Ungrounded claim",
                        value: "Ungrounded value",
                        sourceTitle: "Ungrounded Source",
                        sourceUrl: "https://example.com/ungrounded",
                        publisher: "Example Inc",
                        publishedAt: "2026-01-01",
                        evidenceType: "credible_market_data",
                        confidence: 90,
                      },
                      {
                        // Malformed: missing claim entirely -- must be dropped.
                        claim: "",
                        value: "Value",
                        sourceTitle: "Title",
                        sourceUrl: "https://example.com/malformed",
                        publisher: "",
                        publishedAt: "",
                        evidenceType: "other",
                        confidence: 50,
                      },
                    ],
                  }),
                  annotations: [
                    { type: "url_citation", url: "https://example.com/grounded" },
                  ],
                },
              ],
            },
          ],
        };
      },
    },
  };

  const result = await executeMarketResearchTask({
    client: fakeClient,
    model: "gpt-5-mini",
    task,
    signal: new AbortController().signal,
  });

  assert.equal(result.status, "completed_with_evidence");
  assert.equal(result.items.length, 2);
  const grounded = result.items.find((item) => item.sourceUrl === "https://example.com/grounded");
  const ungrounded = result.items.find((item) => item.sourceUrl === "https://example.com/ungrounded");
  assert.equal(grounded.verified, true);
  assert.ok(grounded.confidence >= 40);
  assert.equal(ungrounded.verified, false);
  assert.ok(ungrounded.confidence <= 30);
});

test("execute: grounds against the real web_search_call.action.sources shape (confirmed live, not just inline url_citation annotations), and rescales a 0-1 confidence fraction", async () => {
  const [task] = marketTasks("Market Intelligence report on the AI legal software market.");
  const fakeClient = {
    responses: {
      async create() {
        return {
          output: [
            {
              type: "web_search_call",
              status: "completed",
              action: {
                type: "search",
                query: "irrelevant",
                sources: [
                  { type: "url", url: "https://example.com/tool-found" },
                ],
              },
            },
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  annotations: [],
                  text: JSON.stringify({
                    field: task.field,
                    findings: [
                      {
                        claim: "Grounded via web_search_call sources",
                        value: "Value",
                        sourceTitle: "Title",
                        sourceUrl: "https://example.com/tool-found",
                        publisher: "Example Inc",
                        publishedAt: "2026-01-01",
                        evidenceType: "credible_market_data",
                        confidence: 0.92,
                      },
                      {
                        claim: "Never surfaced by the search tool itself",
                        value: "Value",
                        sourceTitle: "Title",
                        sourceUrl: "https://example.com/model-only",
                        publisher: "Example Inc",
                        publishedAt: "2026-01-01",
                        evidenceType: "credible_market_data",
                        confidence: 0.92,
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        };
      },
    },
  };

  const result = await executeMarketResearchTask({
    client: fakeClient,
    model: "gpt-5-mini",
    task,
    signal: new AbortController().signal,
  });

  const grounded = result.items.find((item) => item.sourceUrl === "https://example.com/tool-found");
  const modelOnly = result.items.find((item) => item.sourceUrl === "https://example.com/model-only");
  assert.equal(grounded.verified, true);
  // 0.92 must be read as a 92% fraction, not literally 0.92/100.
  assert.equal(grounded.confidence, 92);
  assert.equal(modelOnly.verified, false);
  assert.ok(modelOnly.confidence <= 30);
});

test("execute: a provider error yields a failed outcome with no evidence, never a fabricated one", async () => {
  const [task] = marketTasks("Market Intelligence report on the CRM platforms market.");
  const fakeClient = {
    responses: {
      async create() {
        throw new Error("provider unavailable");
      },
    },
  };

  const result = await executeMarketResearchTask({
    client: fakeClient,
    model: "gpt-5-mini",
    task,
    signal: new AbortController().signal,
  });

  assert.equal(result.status, "failed");
  assert.equal(result.items.length, 0);
  assert.match(result.reason, /provider unavailable/);
});

test("isMarketResearchV2Enabled reflects the ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2 env flag", () => {
  const original = process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2;
  try {
    delete process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2;
    assert.equal(isMarketResearchV2Enabled(), false);
    process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2 = "true";
    assert.equal(isMarketResearchV2Enabled(), true);
    process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2 = "false";
    assert.equal(isMarketResearchV2Enabled(), false);
  } finally {
    if (original === undefined) delete process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2;
    else process.env.ENABLE_MARKET_INTELLIGENCE_RESEARCH_V2 = original;
  }
});

test("runMarketIntelligenceResearchV2 end-to-end with a stub client produces a full DomainResearchBundle across every required field", async () => {
  const fakeClient = {
    responses: {
      async create(request) {
        const schema = request.text.format.schema;
        const field = schema.properties.field.enum[0];
        const url = `https://example.com/${field}`;
        return {
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    field,
                    findings: [
                      {
                        claim: `${field} claim`,
                        value: `${field} value`,
                        sourceTitle: `${field} source`,
                        sourceUrl: url,
                        publisher: "Example Publisher",
                        publishedAt: "2026-01-01",
                        evidenceType: "credible_market_data",
                        confidence: 85,
                      },
                    ],
                  }),
                  annotations: [{ type: "url_citation", url }],
                },
              ],
            },
          ],
        };
      },
    },
  };

  const bundle = await runMarketIntelligenceResearchV2({
    client: fakeClient,
    model: "gpt-5-mini",
    prompt: "Market Intelligence report on the Healthcare AI market.",
    assets: [],
    language: "English",
  });

  assert.equal(bundle.recommendedOutput, "full_report");
  assert.equal(bundle.researchCompleted, true);
  assert.equal(bundle.requiredResearchCompletion, 100);
  assert.equal(bundle.unresolvedFields.length, 0);
  assert.equal(bundle.evidence.length, bundle.attemptedFields.length);
  assert.ok(bundle.evidence.every((item) => item.label === "Verified from external source"));
  assert.equal(bundle.fallbackUsed, false);
});

// domain-research.ts's validateDomainResearchQuality (the report quality
// gate market-analysis/route.ts runs on every bundle, V2's included) can't
// be imported here -- it pulls in "server-only" transitively, the same
// constraint that keeps every other test in this suite from importing
// domain-research.ts as a value (confirmed via decision-intelligence-
// engine.test.mjs, which only regex-matches its source text for the same
// reason). These two checks are copied verbatim from its real logic
// (domain-research.ts ~4501-4526) so this suite still catches the exact
// integration bug that slipped through before: a plan item whose status
// is "completed_with_evidence" with no sourceUrls/sourceTitles behind it,
// and a requiredResearchCompletion value that disagrees with how many
// required plan items actually carry that status.
function assertBundleSatisfiesReportQualityGateInvariants(bundle) {
  const invalidCompletedTask = bundle.plan.find(
    (task) =>
      task.status === "completed_with_evidence" &&
      (!task.sourceUrls?.length || !task.sourceTitles?.length)
  );
  assert.equal(
    invalidCompletedTask,
    undefined,
    `task ${invalidCompletedTask?.id} is completed_with_evidence without sourceUrls/sourceTitles`
  );

  const requiredTasks = bundle.plan.filter((task) => task.required);
  const completedRequiredTasks = requiredTasks.filter(
    (task) => task.status === "completed_with_evidence"
  );
  const mathematicallyExpectedCompletion = requiredTasks.length
    ? Math.round((completedRequiredTasks.length / requiredTasks.length) * 100)
    : 100;
  assert.equal(bundle.requiredResearchCompletion, mathematicallyExpectedCompletion);
  if (bundle.researchCompleted) {
    assert.equal(mathematicallyExpectedCompletion, 100);
  }
}

test("adapter: a bundle with a mix of verified and ungrounded-only fields satisfies the report quality gate's plan-consistency invariants", () => {
  const tasks = marketTasks("Market Intelligence report on the Brazilian fintech lending market.");
  const requiredTasks = tasks.filter((task) => task.required);
  const optionalTasks = tasks.filter((task) => !task.required);
  assert.ok(requiredTasks.length >= 2 && optionalTasks.length >= 2, "fixture assumption");

  const outcomes = tasks.map((task, index) => {
    if (task.required && index === 0) return outcome(task, { unverified: [1] }); // required, ungrounded-only
    if (task.required) return outcome(task, { verified: [1] }); // required, grounded
    if (!task.required && index % 2 === 0) return outcome(task, { verified: [1], unverified: [1] }); // mixed
    return outcome(task, {}); // no evidence at all
  });
  const completeness = assessMarketEvidenceCompleteness(outcomes);
  const bundle = buildMarketResearchV2Bundle({ outcomes, completeness });

  assertBundleSatisfiesReportQualityGateInvariants(bundle);
  // The specific scenario that used to slip through: the ungrounded-only
  // required task must NOT be reported as completed_with_evidence.
  const ungroundedRequiredTask = bundle.plan.find((task) => task.id === requiredTasks[0].id);
  assert.equal(ungroundedRequiredTask.status, "completed_no_evidence");
  assert.deepEqual(ungroundedRequiredTask.sourceUrls, []);
});

test("adapter: a fully-verified bundle also satisfies the report quality gate's plan-consistency invariants", () => {
  const tasks = marketTasks("Market Intelligence report on the Nordic electric vehicle charging market.");
  const outcomes = tasks.map((task) => outcome(task, { verified: [1, 2] }));
  const completeness = assessMarketEvidenceCompleteness(outcomes);
  const bundle = buildMarketResearchV2Bundle({ outcomes, completeness });

  assertBundleSatisfiesReportQualityGateInvariants(bundle);
  assert.ok(bundle.plan.every((task) => task.sourceUrls.length > 0 && task.sourceTitles.length > 0));
});
