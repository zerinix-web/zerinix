import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR,
  isExecutiveBriefGeneratorEnabled,
  executiveBriefSchema,
  generateExecutiveBrief,
} from "../app/lib/ai/executive-brief-generator.ts";
import {
  runExecutiveDecisionSystem,
  executiveDecisionPackageSchema,
} from "../app/lib/ai/executive-decision-system.ts";

const engineSource = await readFile(
  new URL("../app/lib/ai/executive-brief-generator.ts", import.meta.url),
  "utf8"
);

function withEnvFlag(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  }
}

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

const LEGAL_DOC_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

function realSuccessfulPackage() {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.status, "ready_for_report_generation");
  assert.ok(pkg.businessIntelligence && pkg.executiveDecisionBrief);
  return pkg;
}

function clonedValidPackage(mutate) {
  const base = structuredClone(realSuccessfulPackage());
  const mutated = mutate(base);
  const check = executiveDecisionPackageSchema.safeParse(mutated);
  assert.equal(check.success, true, `mutated fixture must remain schema-valid: ${JSON.stringify(check.error?.issues)}`);
  return check.data;
}

test("isExecutiveBriefGeneratorEnabled reads the env var exactly", () => {
  assert.equal(isExecutiveBriefGeneratorEnabled({}), false);
  assert.equal(isExecutiveBriefGeneratorEnabled({ [EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isExecutiveBriefGeneratorEnabled({ [EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) the brief is disabled and nothing is generated, even with a real package supplied", () => {
  withEnvFlag(EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR, undefined, () => {
    const pkg = realSuccessfulPackage();
    const brief = generateExecutiveBrief({ executiveDecisionPackage: pkg });
    assert.equal(executiveBriefSchema.safeParse(brief).success, true);
    assert.equal(brief.enabled, false);
    assert.equal(brief.generated, false);
    assert.equal(brief.executiveSummary, null);
    assert.deepEqual(brief.keyFindings, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  withEnvFlag(EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR, undefined, () => {
    const pkg = realSuccessfulPackage();
    const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
    assert.equal(brief.enabled, true);
    assert.equal(brief.generated, true);
  });
});

test("setting the env var to 'true' also enables generation", () => {
  withEnvFlag(EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR, "true", () => {
    const pkg = realSuccessfulPackage();
    const brief = generateExecutiveBrief({ executiveDecisionPackage: pkg });
    assert.equal(brief.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag(EXECUTIVE_BRIEF_GENERATOR_ENABLED_ENV_VAR, "true", () => {
    const pkg = realSuccessfulPackage();
    const brief = generateExecutiveBrief({ enabled: false, executiveDecisionPackage: pkg });
    assert.equal(brief.enabled, false);
    assert.equal(brief.generated, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid brief", () => {
  const brief = generateExecutiveBrief();
  assert.equal(executiveBriefSchema.safeParse(brief).success, true);
  assert.equal(brief.enabled, false);
});

test("enabled but no package supplied: nothing is generated, never a fabricated placeholder brief", () => {
  const brief = generateExecutiveBrief({ enabled: true });
  assert.equal(executiveBriefSchema.safeParse(brief).success, true);
  assert.equal(brief.generated, false);
  assert.match(brief.reasonNotGenerated, /No valid Executive Decision System package/);
  assert.equal(brief.status, "not_started");
});

test("enabled with malformed input: nothing is generated", () => {
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: { status: "not-a-real-status" } });
  assert.equal(brief.generated, false);
});

test("enabled with a valid package that never computed Business Intelligence / Executive Decision Brief data (e.g. a non-Business-Intelligence domain like a legal document): honestly reports the real status, generates nothing fabricated", () => {
  const { package: legalPkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "Please review this.",
    attachments: [{ name: "contract.pdf", textContent: LEGAL_DOC_TEXT }],
  });
  assert.equal(legalPkg.businessIntelligence, null);

  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: legalPkg });
  assert.equal(brief.generated, false);
  assert.equal(brief.status, legalPkg.status);
  assert.match(brief.reasonNotGenerated, /did not compute Business Intelligence/);
});

test("successful generation: all 8 required sections are present as distinct, independently inspectable fields", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });

  assert.equal(executiveBriefSchema.safeParse(brief).success, true);
  assert.equal(brief.generated, true);
  for (const section of [
    "executiveSummary",
    "keyFindings",
    "criticalRisks",
    "strategicOpportunities",
    "recommendedDecisions",
    "immediateNextActions",
    "confidenceAssessment",
    "supportingEvidenceSummary",
  ]) {
    assert.ok(Object.prototype.hasOwnProperty.call(brief, section), `expected a distinct ${section} field`);
  }
  assert.equal(typeof brief.executiveSummary, "string");
  assert.ok(Array.isArray(brief.keyFindings));
  assert.ok(Array.isArray(brief.criticalRisks));
  assert.ok(Array.isArray(brief.strategicOpportunities));
  assert.ok(Array.isArray(brief.recommendedDecisions));
  assert.ok(Array.isArray(brief.immediateNextActions));
  assert.equal(typeof brief.confidenceAssessment, "object");
  assert.equal(typeof brief.supportingEvidenceSummary, "object");
});

test("Executive Summary is real, built from Executive Decision Brief's own recommendation, recommendation status, and the real aggregate confidence -- never invented", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });

  assert.ok(brief.executiveSummary.includes(pkg.executiveDecisionBrief.executiveRecommendation.slice(0, 50)));
  assert.match(brief.executiveSummary, new RegExp(`Recommendation status: "${pkg.executiveDecisionBrief.recommendationStatus}"`));
  assert.match(brief.executiveSummary, new RegExp(`Aggregate confidence: ${pkg.businessIntelligence.aggregateConfidence}/100`));
});

test("Key Findings are real, unmodified reads of Executive Decision Brief's own decision rationale", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
  assert.deepEqual(brief.keyFindings, pkg.executiveDecisionBrief.decisionRationale);
});

test("Recommended Decisions always includes the real recommendation status, and the Executive Advisory's own nextDecisions when available", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
  assert.ok(
    brief.recommendedDecisions.includes(`Recommended decision: ${pkg.executiveDecisionBrief.recommendationStatus}.`)
  );

  const advisoryPkg = clonedValidPackage((base) => ({
    ...base,
    executiveDecisionBrief: {
      ...base.executiveDecisionBrief,
      executiveAdvisory: {
        domain: "business",
        executiveRecommendationHeadline: base.executiveDecisionBrief.executiveRecommendation,
        why: base.executiveDecisionBrief.decisionRationale,
        supportingEvidence: base.executiveDecisionBrief.verifiedEvidence,
        contradictoryEvidence: [],
        confidenceNarrative: base.executiveDecisionBrief.confidenceExplanation,
        businessImpact: ["Pricing strategy directly affects near-term revenue."],
        risks: base.executiveDecisionBrief.keyRisks,
        opportunities: ["Signed letters of intent indicate genuine near-term demand."],
        assumptions: base.executiveDecisionBrief.assumptions,
        missingEvidence: base.executiveDecisionBrief.missingCriticalEvidence,
        nextDecisions: ["Decide A.", "Decide B.", "Decide C."],
        structureNotes: ['Structured using verified-evidence business reasoning for the "business" context.'],
      },
    },
  }));
  const advisoryBrief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: advisoryPkg });
  for (const decision of ["Decide A.", "Decide B.", "Decide C."]) {
    assert.ok(advisoryBrief.recommendedDecisions.includes(decision));
  }
  assert.ok(advisoryBrief.strategicOpportunities.includes("Signed letters of intent indicate genuine near-term demand."));
});

test("every immediate next action references its own supporting evidence internally, and that evidence is real -- never a fabricated citation", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });

  assert.ok(brief.immediateNextActions.length > 0);
  const realEvidencePool = [
    ...pkg.executiveDecisionBrief.verifiedEvidence,
    ...pkg.executiveDecisionBrief.assumptions,
    ...pkg.executiveDecisionBrief.missingCriticalEvidence,
    ...pkg.executiveDecisionBrief.keyRisks,
    ...pkg.executiveDecisionBrief.immediateNextActions,
    ...(pkg.businessIntelligence.researchPrioritization?.prioritizedTasks.map((t) => t.explanation) ?? []),
  ];

  for (const entry of brief.immediateNextActions) {
    assert.ok(entry.supportingEvidence.length >= 1);
    for (const citation of entry.supportingEvidence) {
      assert.ok(
        realEvidencePool.some((real) => real.includes(citation) || citation === entry.action),
        `expected citation to be real, verbatim evidence, got: ${citation}`
      );
    }
  }

  const topTask = pkg.businessIntelligence.researchPrioritization.prioritizedTasks[0];
  const topResearchEntry = brief.immediateNextActions.find((entry) => entry.source === "top_research_priority");
  assert.ok(topResearchEntry, "expected the top-ranked research task to appear as an immediate next action");
  assert.equal(topResearchEntry.action, topTask.topic);
});

test("Confidence Assessment surfaces the real aggregate confidence, decision confidence, and Confidence Engine's own drivers/penalties", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });

  assert.equal(brief.confidenceAssessment.aggregateConfidence, pkg.businessIntelligence.aggregateConfidence);
  assert.equal(brief.confidenceAssessment.decisionConfidence, pkg.executiveDecisionBrief.decisionConfidence);
  assert.deepEqual(brief.confidenceAssessment.drivers, pkg.businessIntelligence.confidence.confidenceDrivers);
  assert.deepEqual(brief.confidenceAssessment.penalties, pkg.businessIntelligence.confidence.confidencePenalties);
});

test("Supporting Evidence Summary clearly separates verified facts, assumptions, inferred conclusions, and unknowns into four distinct lists", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
  const summary = brief.supportingEvidenceSummary;

  assert.deepEqual(summary.verifiedFacts, pkg.executiveDecisionBrief.verifiedEvidence);
  assert.deepEqual(summary.assumptions, pkg.executiveDecisionBrief.assumptions);
  assert.deepEqual(summary.inferredConclusions, pkg.executiveDecisionBrief.directionalSignals);
  for (const gap of pkg.executiveDecisionBrief.missingCriticalEvidence) {
    assert.ok(summary.unknowns.includes(gap));
  }
  assert.equal(summary.evidenceQualityScore, pkg.businessIntelligence.evidenceQuality.overallPoolScore);
});

test("Supporting Evidence Summary's source reliability and corroboration summaries are real, deterministic derivations, honestly reporting 'none' when nothing was assessed", () => {
  const pkg = realSuccessfulPackage();
  assert.deepEqual(pkg.businessIntelligence.sourceReliability.sources, []);
  assert.deepEqual(pkg.businessIntelligence.evidenceCorroboration.conclusions, []);

  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
  assert.equal(brief.supportingEvidenceSummary.sourceReliabilitySummary, "No sources were assessed for reliability.");
  assert.equal(brief.supportingEvidenceSummary.corroborationSummary, "No conclusions were checked for corroboration.");
});

test("source reliability summary is a real mean computed from actual source scores when sources exist", () => {
  const sourcedPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: {
      ...base.businessIntelligence,
      sourceReliability: {
        enabled: true,
        sources: [
          {
            enabled: true,
            sourceName: "Gartner",
            reliabilityScore: 80,
            dimensionScores: [],
            flags: [],
            isAnonymousOrWeak: false,
            isHighlyTrusted: true,
            reliabilityDrivers: [],
            reliabilityPenalties: [],
            scoringTrace: ["scored"],
          },
          {
            enabled: true,
            sourceName: "Random Blog",
            reliabilityScore: 20,
            dimensionScores: [],
            flags: ["weak_source"],
            isAnonymousOrWeak: true,
            isHighlyTrusted: false,
            reliabilityDrivers: [],
            reliabilityPenalties: [],
            scoringTrace: ["scored"],
          },
        ],
      },
    },
  }));

  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: sourcedPkg });
  assert.equal(brief.supportingEvidenceSummary.sourceReliabilitySummary, "2 source(s) assessed; mean reliability 50/100; 1 anonymous/weak source(s) flagged.");
});

test("Critical Risks combines Expert Reasoning's own keyRisks with real, literally-quoted detected conflicts -- honestly empty when there are none", () => {
  const pkg = realSuccessfulPackage();
  assert.deepEqual(pkg.businessIntelligence.conflictDetection.conflicts, []);
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
  assert.deepEqual(brief.criticalRisks, pkg.executiveDecisionBrief.keyRisks);

  const conflictPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: {
      ...base.businessIntelligence,
      conflictDetection: {
        ...base.businessIntelligence.conflictDetection,
        overallSeverity: "high",
        confidenceImpact: 60,
        conflicts: [
          {
            topicId: "topic_0",
            a: "item_0",
            b: "item_1",
            sourceA: "Gartner",
            sourceB: "Forrester",
            reason: "Both items discuss the same topic but cite different figures.",
            conflictType: "numeric_mismatch",
            severity: "high",
          },
        ],
      },
    },
  }));
  const conflictBrief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: conflictPkg });
  assert.ok(
    conflictBrief.criticalRisks.some(
      (risk) => risk === "Unresolved evidence conflict [high]: Both items discuss the same topic but cite different figures."
    )
  );
});

test("evidence trace combines the brief's own trace with Decision Engine's own trace, deduplicated -- preserving evidence traceability", () => {
  const pkg = realSuccessfulPackage();
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg });
  for (const line of pkg.executiveDecisionBrief.evidenceTrace) {
    assert.ok(brief.evidenceTrace.includes(line));
  }
  assert.equal(brief.evidenceTrace.length, new Set(brief.evidenceTrace).size);
});

test("identical input always produces an identical result (determinism)", () => {
  const pkg = realSuccessfulPackage();
  const a = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: structuredClone(pkg) });
  const b = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: structuredClone(pkg) });
  assert.deepEqual(a, b);
});

test("never fabricates: the whole brief always parses under the strict schema, for every scenario exercised in this file", () => {
  const scenarios = [
    generateExecutiveBrief(),
    generateExecutiveBrief({ enabled: true }),
    generateExecutiveBrief({ enabled: true, executiveDecisionPackage: realSuccessfulPackage() }),
  ];
  for (const brief of scenarios) {
    assert.equal(executiveBriefSchema.safeParse(brief).success, true);
  }
});

test("does not modify UI, PDF generation, billing, authentication, routing, report schema, or localization, and is wired into app/api/plan/route.ts only, behind the Executive Decision System success path", async () => {
  assert.doesNotMatch(engineSource, /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth|report-language)/i);

  // ZERINIX end-to-end Executive Decision production flow (v1): route.ts
  // legitimately calls generateExecutiveBrief exactly once, from the
  // same executiveDecisionPackage and strategicDecisionMemo -- see the
  // end-to-end pipeline test file for full coverage.
  const planRouteSource = await readFile(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");
  assert.match(planRouteSource, /generateExecutiveBrief\(/);
  const routeCallCount = (planRouteSource.match(/generateExecutiveBrief\(/g) || []).length;
  assert.equal(routeCallCount, 1, "generateExecutiveBrief must be called exactly once in route.ts");

  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "executive-brief-generator.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /executive-brief-generator|generateExecutiveBrief/,
      `expected ${file} to not yet reference the new Executive Brief Generator`
    );
  }
});

test("does not call or modify the existing ExpertReasoningResult-primary executive-decision-brief.ts pipeline -- reads its already-computed output only, via the Executive Decision Package", () => {
  assert.doesNotMatch(engineSource, /buildExecutiveDecisionBriefFromExpertReasoning\(|buildExecutiveDecisionBrief\(/);
  assert.doesNotMatch(engineSource, /runExpertReasoningEngine\(/);
});
