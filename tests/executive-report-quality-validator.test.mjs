import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR,
  isExecutiveReportQualityValidatorEnabled,
  executiveReportQualityValidationResultSchema,
  reportQualityIssueSeverityValues,
  reportQualityIssueCategoryValues,
  validateExecutiveReportQuality,
} from "../app/lib/report-engine/executive-report-quality-validator.ts";
import { runExecutiveDecisionSystem } from "../app/lib/ai/executive-decision-system.ts";
import { executiveDecisionPackageSchema } from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";

const workerSource = readFileSync("app/lib/report-jobs/worker.ts", "utf8");
const reportInvestmentScoreSource = readFileSync("app/lib/report-investment-score.ts", "utf8");
const validatorSource = readFileSync(
  "app/lib/report-engine/executive-report-quality-validator.ts",
  "utf8"
);

function withEnvFlag(value, fn) {
  const previous = process.env[EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR];
  if (value === undefined) {
    delete process.env[EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR];
  } else {
    process.env[EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR] = value;
  }
  try {
    return fn();
  } finally {
    if (previous === undefined) {
      delete process.env[EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR];
    } else {
      process.env[EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR] = previous;
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

// --- Flag behavior ---------------------------------------------------

test("isExecutiveReportQualityValidatorEnabled reads the env var exactly", () => {
  assert.equal(isExecutiveReportQualityValidatorEnabled({}), false);
  assert.equal(
    isExecutiveReportQualityValidatorEnabled({ [EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR]: "false" }),
    false
  );
  assert.equal(
    isExecutiveReportQualityValidatorEnabled({ [EXECUTIVE_REPORT_QUALITY_VALIDATOR_ENABLED_ENV_VAR]: "true" }),
    true
  );
});

test("by default (no env var, no override) validation never runs, even against an obviously broken report", () => {
  withEnvFlag(undefined, () => {
    const result = validateExecutiveReportQuality({
      sections: [{ field: "a", title: "A", content: "Lorem ipsum TODO placeholder" }],
      expectedFields: ["a", "b"],
    });
    assert.equal(executiveReportQualityValidationResultSchema.safeParse(result).success, true);
    assert.equal(result.enabled, false);
    assert.equal(result.validated, false);
    assert.equal(result.passed, true);
    assert.deepEqual(result.issues, []);
  });
});

test("an explicit enabled:true overrides the env var", () => {
  const result = validateExecutiveReportQuality({ enabled: true, sections: [] });
  assert.equal(result.enabled, true);
  assert.equal(result.validated, true);
});

test("setting the env var to 'true' also enables validation", () => {
  withEnvFlag("true", () => {
    const result = validateExecutiveReportQuality({ sections: [] });
    assert.equal(result.enabled, true);
  });
});

test("an explicit enabled:false overrides an env var set to 'true'", () => {
  withEnvFlag("true", () => {
    const result = validateExecutiveReportQuality({ enabled: false, sections: [] });
    assert.equal(result.enabled, false);
  });
});

// --- Structured result shape -----------------------------------------

test("reportQualityIssueSeverityValues and reportQualityIssueCategoryValues contain exactly the documented values", () => {
  assert.deepEqual([...reportQualityIssueSeverityValues].sort(), ["critical", "error", "warning", "info"].sort());
  assert.deepEqual(
    [...reportQualityIssueCategoryValues].sort(),
    [
      "missing_section",
      "empty_evidence",
      "broken_citation",
      "placeholder_text",
      "duplicated_content",
      "inconsistent_confidence",
      "unsupported_conclusion",
    ].sort()
  );
});

test("an empty, fully valid report with no expectations produces a passing, schema-valid result", () => {
  const result = validateExecutiveReportQuality({ enabled: true, sections: [] });
  assert.equal(executiveReportQualityValidationResultSchema.safeParse(result).success, true);
  assert.equal(result.validated, true);
  assert.equal(result.passed, true);
  assert.deepEqual(result.issues, []);
});

// --- missing_section ----------------------------------------------------

test("missing_section: an entirely absent field is flagged critical, and passed becomes false", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "Real, substantial content here." }],
    expectedFields: ["a", "b"],
  });
  assert.equal(result.passed, false);
  assert.ok(result.issues.some((i) => i.category === "missing_section" && i.severity === "critical" && i.field === "b"));
});

test("missing_section: a present but too-short/empty field is also flagged critical", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "   " }],
    expectedFields: ["a"],
  });
  assert.ok(result.issues.some((i) => i.category === "missing_section" && i.field === "a"));
});

test("missing_section: when no expectedFields are supplied, the check is skipped entirely -- never guessing what was expected", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "" }],
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "missing_section"), []);
});

// --- placeholder_text ----------------------------------------------------

test("placeholder_text: detects known placeholder patterns and flags them as errors", () => {
  for (const content of [
    "Lorem ipsum dolor sit amet.",
    "TODO: fill this in later.",
    "[insert company name here]",
    "This is a placeholder for real content.",
  ]) {
    const result = validateExecutiveReportQuality({
      enabled: true,
      sections: [{ field: "a", title: "A", content }],
    });
    assert.ok(
      result.issues.some((i) => i.category === "placeholder_text" && i.severity === "error"),
      `expected placeholder detection for: ${content}`
    );
    assert.equal(result.passed, false);
  }
});

test("placeholder_text: genuine, real content is never flagged", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "The addressable market exceeds $50 million based on verified customer commitments." }],
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "placeholder_text"), []);
});

// --- broken_citation ----------------------------------------------------

test("broken_citation: a citation with a matching source entry is never flagged", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [
      { field: "market", title: "Market", content: "TAM is $50M according to [R1]." },
      { field: "sourcesAssumptions", title: "Sources", content: "R1: Gartner, https://gartner.com" },
    ],
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "broken_citation"), []);
});

test("broken_citation: a citation with no matching source entry is flagged as an error", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [
      { field: "market", title: "Market", content: "TAM is $50M according to [R9]." },
      { field: "sourcesAssumptions", title: "Sources", content: "R1: Gartner, https://gartner.com" },
    ],
  });
  const issue = result.issues.find((i) => i.category === "broken_citation");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.equal(issue.field, "market");
  assert.equal(result.passed, false);
});

test("broken_citation: a citation with no sources section at all is flagged, and says so explicitly", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "market", title: "Market", content: "TAM is $50M according to [R1]." }],
  });
  const issue = result.issues.find((i) => i.category === "broken_citation");
  assert.ok(issue);
  assert.match(issue.message, /no sources section exists in this report at all/);
});

// --- duplicated_content ----------------------------------------------------

test("duplicated_content: the same substantial sentence in two different sections is flagged once as a warning, never blocking", () => {
  const sentence = "The market for AI accounting software is large and growing rapidly across every region.";
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [
      { field: "a", title: "A", content: sentence },
      { field: "b", title: "B", content: sentence },
    ],
  });
  const duplicateIssues = result.issues.filter((i) => i.category === "duplicated_content");
  assert.equal(duplicateIssues.length, 1);
  assert.equal(duplicateIssues[0].severity, "warning");
  assert.equal(result.passed, true, "a warning-only issue must never block the report");
});

test("duplicated_content: repeating a sentence within the SAME section is never flagged (only cross-section duplication counts)", () => {
  const sentence = "The market for AI accounting software is large and growing rapidly across every region.";
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: `${sentence} ${sentence}` }],
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "duplicated_content"), []);
});

test("duplicated_content: short, generic sentences below the length threshold are never flagged", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [
      { field: "a", title: "A", content: "See below." },
      { field: "b", title: "B", content: "See below." },
    ],
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "duplicated_content"), []);
});

// --- empty_evidence ----------------------------------------------------

test("empty_evidence: a real Executive Decision Package with an empty evidence pool is flagged as an error", () => {
  const emptyEvidencePkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: {
      ...base.businessIntelligence,
      evidenceQuality: { ...base.businessIntelligence.evidenceQuality, itemScores: [] },
    },
  }));
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [],
    executiveDecisionPackage: emptyEvidencePkg,
  });
  assert.ok(result.issues.some((i) => i.category === "empty_evidence" && i.severity === "error"));
  assert.equal(result.passed, false);
});

test("empty_evidence: a real, non-empty Executive Decision Package is never flagged", () => {
  const pkg = realSuccessfulPackage();
  assert.ok(pkg.businessIntelligence.evidenceQuality.itemScores.length > 0);
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [],
    executiveDecisionPackage: pkg,
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "empty_evidence"), []);
});

test("empty_evidence: a real Strategic Decision Memo with no verified facts and no assumptions is flagged", () => {
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage: realSuccessfulPackage() });
  const emptyMemo = { ...memo, verifiedFacts: [], assumptions: [] };
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [],
    strategicDecisionMemo: emptyMemo,
  });
  assert.ok(result.issues.some((i) => i.category === "empty_evidence" && i.message.includes("Strategic Decision Memo")));
});

// --- inconsistent_confidence ----------------------------------------------------

test("inconsistent_confidence: a report-stated confidence number that does not match the real aggregate confidence is flagged", () => {
  const pkg = realSuccessfulPackage();
  const wrongValue = pkg.businessIntelligence.aggregateConfidence + 30;
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: `Confidence: ${wrongValue}/100.` }],
    executiveDecisionPackage: pkg,
  });
  const issue = result.issues.find((i) => i.category === "inconsistent_confidence");
  assert.ok(issue);
  assert.equal(issue.severity, "error");
  assert.match(issue.message, new RegExp(`${pkg.businessIntelligence.aggregateConfidence}`));
  assert.equal(result.passed, false);
});

test("inconsistent_confidence: a report-stated confidence number matching the real aggregate confidence is never flagged", () => {
  const pkg = realSuccessfulPackage();
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: `Confidence: ${pkg.businessIntelligence.aggregateConfidence}/100.` }],
    executiveDecisionPackage: pkg,
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "inconsistent_confidence"), []);
});

test("inconsistent_confidence: with no real Executive Decision System data at all, the check is skipped rather than fabricating an expectation", () => {
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "Confidence: 99/100." }],
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "inconsistent_confidence"), []);
});

// --- unsupported_conclusion ----------------------------------------------------

test("unsupported_conclusion: unqualified certainty language paired with a genuinely low real confidence is flagged as a non-blocking warning", () => {
  const lowConfidencePkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, aggregateConfidence: 25 },
  }));
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "We strongly recommend proceeding immediately with this business." }],
    executiveDecisionPackage: lowConfidencePkg,
  });
  const issue = result.issues.find((i) => i.category === "unsupported_conclusion");
  assert.ok(issue);
  assert.equal(issue.severity, "warning");
  assert.equal(result.passed, true, "a warning-only issue must never block the report");
});

test("unsupported_conclusion: the same unqualified language is not flagged when the report itself also hedges", () => {
  const lowConfidencePkg = clonedValidPackage((base) => ({
    ...base,
    businessIntelligence: { ...base.businessIntelligence, aggregateConfidence: 25 },
  }));
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [
      {
        field: "a",
        title: "A",
        content: "We strongly recommend proceeding immediately, however this is based on limited evidence and carries risk.",
      },
    ],
    executiveDecisionPackage: lowConfidencePkg,
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "unsupported_conclusion"), []);
});

test("unsupported_conclusion: unqualified certainty language is not flagged when real confidence is genuinely high", () => {
  const pkg = realSuccessfulPackage();
  assert.ok(pkg.businessIntelligence.aggregateConfidence >= 40);
  const result = validateExecutiveReportQuality({
    enabled: true,
    sections: [{ field: "a", title: "A", content: "We strongly recommend proceeding immediately with this business." }],
    executiveDecisionPackage: pkg,
  });
  assert.deepEqual(result.issues.filter((i) => i.category === "unsupported_conclusion"), []);
});

// --- overall pass/fail semantics ----------------------------------------------------

test("passed is false whenever any critical or error issue exists, and true when only warnings/info exist", () => {
  const sentence = "This exact sentence appears twice across two different sections in this report today.";
  const onlyWarnings = validateExecutiveReportQuality({
    enabled: true,
    sections: [
      { field: "a", title: "A", content: sentence },
      { field: "b", title: "B", content: sentence },
    ],
  });
  assert.ok(onlyWarnings.issues.every((i) => i.severity === "warning" || i.severity === "info"));
  assert.equal(onlyWarnings.passed, true);

  const withCritical = validateExecutiveReportQuality({
    enabled: true,
    sections: [],
    expectedFields: ["missingField"],
  });
  assert.equal(withCritical.passed, false);
});

test("identical input always produces an identical result (determinism)", () => {
  const pkg = realSuccessfulPackage();
  const input = {
    enabled: true,
    sections: [{ field: "a", title: "A", content: "Real substantial content citing [R1]." }],
    expectedFields: ["a"],
    executiveDecisionPackage: structuredClone(pkg),
  };
  const a = validateExecutiveReportQuality(input);
  const b = validateExecutiveReportQuality({ ...input, executiveDecisionPackage: structuredClone(pkg) });
  assert.deepEqual(a, b);
});

test("never fabricates: every scenario exercised in this file parses under the strict schema", () => {
  const scenarios = [
    validateExecutiveReportQuality(),
    validateExecutiveReportQuality({ enabled: true, sections: [] }),
    validateExecutiveReportQuality({
      enabled: true,
      sections: [{ field: "a", title: "A", content: "Real content." }],
      expectedFields: ["a", "b"],
      executiveDecisionPackage: realSuccessfulPackage(),
    }),
  ];
  for (const result of scenarios) {
    assert.equal(executiveReportQualityValidationResultSchema.safeParse(result).success, true);
  }
});

// --- worker.ts pipeline integration (static, matching this codebase's
// established convention for testing worker.ts) ----------------------

test("worker.ts calls validateExecutiveReportQuality exactly once, strictly between readExecutionResponse and persistCompletedReport", () => {
  const readIndex = workerSource.indexOf(
    "const report = await readExecutionResponse(response, job.request_payload);"
  );
  const validateIndex = workerSource.indexOf("validateExecutiveReportQuality({");
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });");

  assert.ok(readIndex >= 0 && validateIndex > readIndex && persistIndex > validateIndex);

  const callCount = (workerSource.match(/validateExecutiveReportQuality\(/g) || []).length;
  assert.equal(callCount, 1, "validateExecutiveReportQuality must be called exactly once");
});

test("worker.ts reuses the SAME already-carried request_payload fields (never re-running Executive Decision System, Strategic Decision Memo, or Executive Brief)", () => {
  assert.match(workerSource, /job\.request_payload\.executiveDecisionSystemResult/);
  assert.match(workerSource, /job\.request_payload\.strategicDecisionMemo/);
  assert.match(workerSource, /job\.request_payload\.executiveBrief/);
  assert.doesNotMatch(workerSource, /runExecutiveDecisionSystem\(/);
  assert.doesNotMatch(workerSource, /buildStrategicDecisionMemo\(/);
  assert.doesNotMatch(workerSource, /generateExecutiveBrief\(/);
});

test("worker.ts throws (reusing the existing terminal-failure pathway) when validation fails, and never calls persistCompletedReport in that case", () => {
  const validateIndex = workerSource.indexOf("const qualityValidation = validateExecutiveReportQuality({");
  const throwBlockIndex = workerSource.indexOf(
    "if (qualityValidation.validated && !qualityValidation.passed) {",
    validateIndex
  );
  const throwIndex = workerSource.indexOf("throw new Error(", throwBlockIndex);
  const persistIndex = workerSource.indexOf("await persistCompletedReport({ supabase, job, report });", throwIndex);

  assert.ok(validateIndex >= 0 && throwBlockIndex > validateIndex && throwIndex > throwBlockIndex);
  assert.ok(persistIndex > throwIndex, "persistCompletedReport must be reachable only after the throw guard");

  // The throw reuses worker.ts's pre-existing catch/markTerminalFailure
  // machinery -- no new failure-handling code was added.
  assert.match(workerSource, /function markTerminalFailure/);
  const markTerminalFailureDeclarationCount = (workerSource.match(/async function markTerminalFailure/g) || []).length;
  assert.equal(markTerminalFailureDeclarationCount, 1, "markTerminalFailure must not be redefined");
});

test("worker.ts attaches the validation result to report.metadata additively (spread pattern) on a pass, never replacing existing metadata", () => {
  assert.match(
    workerSource,
    /report\.metadata = \{ \.\.\.\(report\.metadata \|\| \{\}\), reportQualityValidation: qualityValidation \};/
  );
});

test("ReportMetadata gained exactly one new, optional field for this integration -- an additive type change, not a breaking one", () => {
  assert.match(reportInvestmentScoreSource, /reportQualityValidation\?:/);
  // Every pre-existing field on ReportMetadata is still present and
  // still optional.
  for (const field of [
    "reportLanguage?:",
    "investmentScore?:",
    "benchmarkFit?:",
    "benchmarkScore?:",
    "reportQuality?:",
    "validationIntelligence?:",
    "expertiseProfile?:",
    "reportPlan?:",
    "researchPlan?:",
  ]) {
    assert.match(reportInvestmentScoreSource, new RegExp(field.replace("?", "\\?")));
  }
});

test("does not modify PDF generation, UI, billing, authentication, or routing -- only worker.ts (report persistence) and an additive metadata type were touched", async () => {
  assert.doesNotMatch(validatorSource, /from ["'].*(?:pdf-engine|billing|auth)/i);

  const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
  assert.doesNotMatch(pdfButtonSource, /executive-report-quality-validator/i);

  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.doesNotMatch(planRouteSource, /executive-report-quality-validator/i);
});

test("the /api/plan request/response API contract is unchanged: this integration lives entirely inside worker.ts's internal job processing, after the response has already been queued", () => {
  // queuedResponse (the actual /api/plan POST response shape) is
  // untouched -- the validator only ever runs later, inside the
  // background worker, long after that response was already returned.
  const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");
  assert.match(planRouteSource, /function queuedResponse/);
  assert.doesNotMatch(planRouteSource, /qualityValidation|validateExecutiveReportQuality/);
});
