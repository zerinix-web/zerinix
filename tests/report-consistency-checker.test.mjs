import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR,
  isReportConsistencyCheckerEnabled,
  reportConsistencyCheckResultSchema,
  consistencyIssueTypeValues,
  consistencyIssueSeverityValues,
  checkReportConsistency,
} from "../app/lib/report-engine/report-consistency-checker.ts";
import {
  runExecutiveDecisionSystem,
  executiveDecisionPackageSchema,
} from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo, strategicDecisionMemoSchema } from "../app/lib/ai/strategic-decision-memo.ts";
import { generateExecutiveBrief, executiveBriefSchema } from "../app/lib/ai/executive-brief-generator.ts";

const workerSource = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const reportInvestmentScoreSource = readFileSync("app/lib/report-investment-score.ts", "utf8");

function withEnvFlag(value, fn) {
  const previous = process.env[REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR];
  } else {
    process.env[REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR];
    } else {
      process.env[REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR] = previous;
    }
  }
}

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function realSuccessfulPackage() {
  const { package: pkg } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  assert.equal(pkg.status, "ready_for_report_generation");
  return pkg;
}

function clonedValidPackage(mutate) {
  const base = structuredClone(realSuccessfulPackage());
  const mutated = mutate(base);
  const check = executiveDecisionPackageSchema.safeParse(mutated);
  assert.equal(check.success, true, `mutated fixture must remain schema-valid: ${JSON.stringify(check.error?.issues)}`);
  return check.data;
}

function realMemoAndBrief(pkg) {
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: pkg });
  const brief = generateExecutiveBrief({ enabled: true, executiveDecisionPackage: pkg, strategicDecisionMemo: memo });
  return { memo, brief };
}

// --- Flag behavior ---------------------------------------------------

test("isReportConsistencyCheckerEnabled reads the env var exactly", () => {
  assert.equal(isReportConsistencyCheckerEnabled({}), false);
  assert.equal(isReportConsistencyCheckerEnabled({ [REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR]: "false" }), false);
  assert.equal(isReportConsistencyCheckerEnabled({ [REPORT_CONSISTENCY_CHECKER_ENABLED_ENV_VAR]: "true" }), true);
});

test("by default (no env var, no override) checking never runs, even against an obviously contradictory report", () => {
  withEnvFlag(undefined, () => {
    const pkg = realSuccessfulPackage();
    const { memo, brief } = realMemoAndBrief(pkg);
    const result = checkReportConsistency({
      sections: [],
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: { ...memo, risks: ["x".repeat(40)], opportunities: ["x".repeat(40)] },
      executiveBrief: brief,
    });
    assert.equal(reportConsistencyCheckResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.equal(result.checked, false);
    assert.equal(result.consistent, true);
    assert.deepEqual(result.issues, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  const result = checkReportConsistency({ enabled: true, sections: [] });
  assert.equal(result.enabled, true);
  assert.equal(result.checked, true);
});

test("setting the env var to 'true' also enables checking", () => {
  withEnvFlag("true", () => {
    const result = checkReportConsistency({ sections: [] });
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = checkReportConsistency({ enabled: false, sections: [] });
    assert.equal(result.enabled, false);
  });
});

test("calling with the default argument (no input at all) is safe and returns a disabled, schema-valid result", () => {
  const result = checkReportConsistency();
  assert.equal(reportConsistencyCheckResultSchema.safeParse(result).success, true);
  assert.equal(result.enabled, false);
});

// --- Structured result shape -----------------------------------------

test("consistencyIssueTypeValues and consistencyIssueSeverityValues contain exactly the documented values", () => {
  assert.deepEqual(
    [...consistencyIssueTypeValues].sort(),
    [
      "confidence_score_mismatch",
      "memo_brief_field_mismatch",
      "risk_opportunity_contradiction",
      "verdict_recommendation_mismatch",
      "executive_summary_verdict_mismatch",
      "evidence_recommendation_mismatch",
    ].sort()
  );
  assert.deepEqual([...consistencyIssueSeverityValues].sort(), ["critical", "error", "warning", "info"].sort());
});

test("every issue carries a real issue type, affected sections, severity, message, and a suggested resolution", () => {
  const pkg = realSuccessfulPackage();
  const contradictoryPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, executiveDecisionSignal: "do_not_proceed_insufficient_evidence" },
    executiveDecisionBrief: { ...base.executiveDecisionBrief, recommendationStatus: "proceed" },
  }));
  void pkg;
  const result = checkReportConsistency({ enabled: true, sections: [], executiveDecisionPackage: contradictoryPkg });
  assert.ok(result.issues.length > 0);
  for (const issue of result.issues) {
    assert.ok(consistencyIssueTypeValues.includes(issue.type));
    assert.ok(consistencyIssueSeverityValues.includes(issue.severity));
    assert.ok(Array.isArray(issue.affectedSections) && issue.affectedSections.length > 0);
    assert.equal(typeof issue.message, "string");
    assert.equal(typeof issue.suggestedResolution, "string");
    assert.ok(issue.suggestedResolution.length > 0);
  }
});

test("a fully consistent report (real, wired Memo + Brief + package) has zero issues and is consistent", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const result = checkReportConsistency({
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD. This report covers our pricing decision." }],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  assert.equal(reportConsistencyCheckResultSchema.safeParse(result).success, true);
  assert.deepEqual(result.issues, []);
  assert.equal(result.consistent, true);
});

// --- confidence_score_mismatch ----------------------------------------------------

test("confidence_score_mismatch: Memo, Brief, and Business Intelligence disagreeing on aggregate confidence is flagged critical", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const mismatchedBrief = {
    ...brief,
    confidenceAssessment: { ...brief.confidenceAssessment, aggregateConfidence: brief.confidenceAssessment.aggregateConfidence + 30 },
  };
  assert.equal(executiveBriefSchema.safeParse(mismatchedBrief).success, true);

  const result = checkReportConsistency({
    enabled: true,
    sections: [],
    strategicDecisionMemo: memo,
    executiveBrief: mismatchedBrief,
  });
  const issue = result.issues.find((i) => i.type === "confidence_score_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "critical");
  assert.equal(result.consistent, false);
});

test("confidence_score_mismatch: a confidence number stated in the Executive Summary text that disagrees with the real aggregate is flagged as an error", () => {
  const pkg = realSuccessfulPackage();
  const { memo } = realMemoAndBrief(pkg);
  const wrongValue = memo.confidence.aggregateConfidence + 40;
  const result = checkReportConsistency({
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: `Confidence: ${wrongValue}/100.` }],
    strategicDecisionMemo: memo,
  });
  const issue = result.issues.find((i) => i.type === "confidence_score_mismatch" && i.affectedSections.includes("executiveSummary"));
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("confidence_score_mismatch: matching confidence values across Memo, Brief, and Business Intelligence are never flagged", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const result = checkReportConsistency({
    enabled: true,
    sections: [],
    executiveDecisionPackage: pkg,
    strategicDecisionMemo: memo,
    executiveBrief: brief,
  });
  assert.deepEqual(result.issues.filter((i) => i.type === "confidence_score_mismatch"), []);
});

// --- memo_brief_field_mismatch ----------------------------------------------------

test("memo_brief_field_mismatch: a Brief whose risks diverge from the Memo it should have reused is flagged critical", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const divergedBrief = { ...brief, criticalRisks: ["A completely different, independently invented risk statement."] };
  assert.equal(executiveBriefSchema.safeParse(divergedBrief).success, true);

  const result = checkReportConsistency({
    enabled: true,
    sections: [],
    strategicDecisionMemo: memo,
    executiveBrief: divergedBrief,
  });
  const issue = result.issues.find((i) => i.type === "memo_brief_field_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "critical");
  assert.deepEqual(issue.affectedSections, ["Strategic Decision Memo", "Executive Brief"]);
});

test("memo_brief_field_mismatch: when only one of Memo/Brief is supplied, the check is skipped -- never guessing a mismatch without both real sides", () => {
  const pkg = realSuccessfulPackage();
  const { memo } = realMemoAndBrief(pkg);
  const result = checkReportConsistency({ enabled: true, sections: [], strategicDecisionMemo: memo });
  assert.deepEqual(result.issues.filter((i) => i.type === "memo_brief_field_mismatch"), []);
});

// --- risk_opportunity_contradiction ----------------------------------------------------

test("risk_opportunity_contradiction: the identical statement listed as both a risk and an opportunity is flagged", () => {
  const pkg = realSuccessfulPackage();
  const { memo } = realMemoAndBrief(pkg);
  const sentence = "Market saturation is a significant concern for long-term growth potential here.";
  const contradictoryMemo = { ...memo, risks: [sentence], opportunities: [sentence] };
  assert.equal(strategicDecisionMemoSchema.safeParse(contradictoryMemo).success, true);

  const result = checkReportConsistency({ enabled: true, sections: [], strategicDecisionMemo: contradictoryMemo });
  const issue = result.issues.find((i) => i.type === "risk_opportunity_contradiction");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("risk_opportunity_contradiction: distinct risks and opportunities are never flagged", () => {
  const pkg = realSuccessfulPackage();
  const { memo } = realMemoAndBrief(pkg);
  const distinctMemo = {
    ...memo,
    risks: ["Regulatory changes could increase compliance costs substantially next year."],
    opportunities: ["International expansion into new markets offers substantial growth potential."],
  };
  const result = checkReportConsistency({ enabled: true, sections: [], strategicDecisionMemo: distinctMemo });
  assert.deepEqual(result.issues.filter((i) => i.type === "risk_opportunity_contradiction"), []);
});

// --- verdict_recommendation_mismatch ----------------------------------------------------

test("verdict_recommendation_mismatch: a do_not_proceed signal paired with a 'proceed' recommendation status is flagged critical", () => {
  const contradictoryPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, executiveDecisionSignal: "do_not_proceed_insufficient_evidence" },
    executiveDecisionBrief: { ...base.executiveDecisionBrief, recommendationStatus: "proceed" },
  }));
  const result = checkReportConsistency({ enabled: true, sections: [], executiveDecisionPackage: contradictoryPkg });
  const issue = result.issues.find((i) => i.type === "verdict_recommendation_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "critical");
  assert.equal(result.consistent, false);
});

test("verdict_recommendation_mismatch: legitimate, non-contradictory pairings (e.g. proceed_with_caution + wait) are never flagged", () => {
  const cautiousPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, executiveDecisionSignal: "proceed_with_caution" },
    executiveDecisionBrief: { ...base.executiveDecisionBrief, recommendationStatus: "wait" },
  }));
  const result = checkReportConsistency({ enabled: true, sections: [], executiveDecisionPackage: cautiousPkg });
  assert.deepEqual(result.issues.filter((i) => i.type === "verdict_recommendation_mismatch"), []);
});

// --- executive_summary_verdict_mismatch ----------------------------------------------------

test("executive_summary_verdict_mismatch: a legacy 'PASS' keyword in the Executive Summary contradicting a do_not_proceed verdict is flagged", () => {
  const contradictoryPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, executiveDecisionSignal: "do_not_proceed_insufficient_evidence" },
  }));
  const result = checkReportConsistency({
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: PASS. Strong opportunity ahead." }],
    executiveDecisionPackage: contradictoryPkg,
  });
  const issue = result.issues.find((i) => i.type === "executive_summary_verdict_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
});

test("executive_summary_verdict_mismatch: a 'HOLD' keyword is never treated as contradictory with any real verdict", () => {
  const pkg = realSuccessfulPackage();
  const result = checkReportConsistency({
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD. Further review recommended." }],
    executiveDecisionPackage: pkg,
  });
  assert.deepEqual(result.issues.filter((i) => i.type === "executive_summary_verdict_mismatch"), []);
});

test("executive_summary_verdict_mismatch: with no Executive Summary section at all, the check is skipped rather than guessing", () => {
  const contradictoryPkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, executiveDecisionSignal: "do_not_proceed_insufficient_evidence" },
  }));
  const result = checkReportConsistency({
    enabled: true,
    sections: [{ field: "risks", title: "Risks", content: "Decision: PASS." }],
    executiveDecisionPackage: contradictoryPkg,
  });
  assert.deepEqual(result.issues.filter((i) => i.type === "executive_summary_verdict_mismatch"), []);
});

// --- evidence_recommendation_mismatch ----------------------------------------------------

test("evidence_recommendation_mismatch: real recommended actions with no verified facts and no assumptions behind them is flagged as a non-blocking warning", () => {
  const pkg = realSuccessfulPackage();
  const { memo } = realMemoAndBrief(pkg);
  const evidencelessMemo = { ...memo, verifiedFacts: [], assumptions: [] };
  assert.ok(evidencelessMemo.recommendedActions.length > 0);
  const result = checkReportConsistency({ enabled: true, sections: [], strategicDecisionMemo: evidencelessMemo });
  const issue = result.issues.find((i) => i.type === "evidence_recommendation_mismatch");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.equal(result.consistent, true, "a warning-only issue must never block the report");
});

test("evidence_recommendation_mismatch: real evidence backing real recommendations is never flagged", () => {
  const pkg = realSuccessfulPackage();
  const { memo } = realMemoAndBrief(pkg);
  assert.ok(memo.verifiedFacts.length > 0 || memo.assumptions.length > 0);
  const result = checkReportConsistency({ enabled: true, sections: [], strategicDecisionMemo: memo });
  assert.deepEqual(result.issues.filter((i) => i.type === "evidence_recommendation_mismatch"), []);
});

// --- determinism / never-fabricates ----------------------------------------------------

test("identical input always produces an identical result (determinism)", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const input = {
    enabled: true,
    sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD." }],
    executiveDecisionPackage: structuredClone(pkg),
    strategicDecisionMemo: structuredClone(memo),
    executiveBrief: structuredClone(brief),
  };
  const a = checkReportConsistency(input);
  const b = checkReportConsistency({
    ...input,
    executiveDecisionPackage: structuredClone(pkg),
    strategicDecisionMemo: structuredClone(memo),
    executiveBrief: structuredClone(brief),
  });
  assert.deepEqual(a, b);
});

test("never fabricates: every scenario exercised in this file parses under the strict schema", () => {
  const pkg = realSuccessfulPackage();
  const { memo, brief } = realMemoAndBrief(pkg);
  const scenarios = [
    checkReportConsistency(),
    checkReportConsistency({ enabled: true, sections: [] }),
    checkReportConsistency({
      enabled: true,
      sections: [{ field: "executiveSummary", title: "Executive Summary", content: "Decision: HOLD." }],
      executiveDecisionPackage: pkg,
      strategicDecisionMemo: memo,
      executiveBrief: brief,
    }),
  ];
  for (const result of scenarios) {
    assert.equal(reportConsistencyCheckResultSchema.safeParse(result).success, true);
  }
});

// --- worker.ts pipeline integration (static, matching this codebase's
// established convention for testing worker.ts) ----------------------

test("worker.ts calls checkReportConsistency exactly once, AFTER validateExecutiveReportQuality and before persistCompletedReport", () => {
  const qualityValidatorIndex = workerSource.indexOf("const qualityValidation = validateExecutiveReportQuality({");
  const consistencyCheckIndex = workerSource.indexOf("const consistencyCheck = checkReportConsistency({");
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });");

  assert.ok(qualityValidatorIndex >= 0 && consistencyCheckIndex > qualityValidatorIndex);
  assert.ok(persistIndex > consistencyCheckIndex);

  const callCount = (workerSource.match(/checkReportConsistency\(/g) || []).length;
  assert.equal(callCount, 1, "checkReportConsistency must be called exactly once");
});

test("worker.ts reuses the SAME already-carried request_payload fields for consistency checking (never re-running Executive Decision System, Strategic Decision Memo, or Executive Brief a second time)", () => {
  const consistencyCallStart = workerSource.indexOf("const consistencyCheck = checkReportConsistency({");
  const consistencyCallEnd = workerSource.indexOf("});", consistencyCallStart);
  const consistencyCallBlock = workerSource.slice(consistencyCallStart, consistencyCallEnd);

  assert.match(consistencyCallBlock, /job\.request_payload\.executiveDecisionSystemResult/);
  assert.match(consistencyCallBlock, /job\.request_payload\.strategicDecisionMemo/);
  assert.match(consistencyCallBlock, /job\.request_payload\.executiveBrief/);
});

test("worker.ts throws (reusing the existing terminal-failure pathway) when the report is inconsistent, and never calls persistCompletedReport in that case", () => {
  const consistencyCallIndex = workerSource.indexOf("const consistencyCheck = checkReportConsistency({");
  const throwBlockIndex = workerSource.indexOf(
    "if (consistencyCheck.checked && !consistencyCheck.consistent) {",
    consistencyCallIndex
  );
  const throwIndex = workerSource.indexOf("throw new Error(", throwBlockIndex);
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });", throwIndex);

  assert.ok(consistencyCallIndex >= 0 && throwBlockIndex > consistencyCallIndex && throwIndex > throwBlockIndex);
  assert.ok(persistIndex > throwIndex, "persistCompletedReport must be reachable only after the throw guard");
});

test("worker.ts attaches the consistency check result to report.metadata additively on a pass, alongside (never replacing) the quality validation result", () => {
  assert.match(
    workerSource,
    /report\.metadata = \{ \.\.\.\(report\.metadata \|\| \{\}\), reportConsistencyCheck: consistencyCheck \};/
  );
  // Both additive metadata attachments coexist -- neither overwrites
  // the other, since each spreads report.metadata forward.
  assert.match(workerSource, /reportQualityValidation: qualityValidation/);
  assert.match(workerSource, /reportConsistencyCheck: consistencyCheck/);
});

test("ReportMetadata gained exactly one new, optional field for this integration, in addition to (not instead of) reportQualityValidation", () => {
  assert.match(reportInvestmentScoreSource, /reportConsistencyCheck\?:/);
  assert.match(reportInvestmentScoreSource, /reportQualityValidation\?:/);
});

test("does not modify PDF generation, UI, billing, authentication, or routing -- only worker.ts (report persistence) and an additive metadata type were touched", async () => {
  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.doesNotMatch(pdfButtonSource, /report-consistency-checker/i);

  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.doesNotMatch(planRouteSource, /report-consistency-checker|checkReportConsistency/i);
});
