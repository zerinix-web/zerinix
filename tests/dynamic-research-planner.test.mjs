import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  researchDomainValues,
  researchTaskPriorityValues,
  domainDetectionMethodValues,
  researchTaskSchema,
  dynamicResearchPlannerResultSchema,
  runDynamicResearchPlanner,
} from "../app/lib/ai/dynamic-research-planner.ts";

const plannerSource = await readFile(
  new URL("../app/lib/ai/dynamic-research-planner.ts", import.meta.url),
  "utf8"
);

const EXPECTED_TOPICS_BY_DOMAIN = {
  business: ["Market size", "Competitors", "Pricing", "Business model", "Customers", "GTM"],
  legal: [
    "Case type",
    "Applicable laws",
    "Court decisions",
    "Precedents",
    "Missing evidence",
    "Risks",
    "Strategy",
  ],
  real_estate: ["Location", "Comparable sales", "Rental yield", "Zoning", "Demographics", "Future development"],
  finance: ["Financial statements", "Ratios", "Cash flow", "Risk", "Valuation", "Benchmarks"],
  healthcare: ["Guidelines", "Clinical evidence", "Contraindications", "Risks", "Treatment options"],
  engineering: ["Standards", "Calculations", "Materials", "Safety", "Compliance", "Failure risks"],
};

const PRIORITY_CONFIDENCE_TARGET = {
  critical: 0.85,
  high: 0.75,
  medium: 0.6,
  low: 0.5,
};

const BUSINESS_PROMPT =
  "We have a business idea and want to validate the market size, our competitors, and our pricing strategy before launch.";

const LEGAL_PROMPT =
  "The plaintiff filed litigation against the defendant; the Court of Appeal issued a verdict, and the docket needs review by an attorney.";

const REAL_ESTATE_PROMPT =
  "We are evaluating a real estate property listing, checking zoning, comparable sales, and rental yield in the area.";

const FINANCE_PROMPT =
  "Please review the financial statements, balance sheet, income statement, and cash flow statement for financial health.";

const HEALTHCARE_PROMPT =
  "The patient's diagnosis requires reviewing the medical guideline, contraindication risks, and treatment plan.";

const ENGINEERING_PROMPT =
  "This structural analysis needs a load calculation, material specification, and safety factor per ISO 2394 and ASME standards.";

test("researchDomainValues contains exactly the 6 required domains", () => {
  assert.deepEqual(
    [...researchDomainValues].sort(),
    ["business", "legal", "real_estate", "finance", "healthcare", "engineering"].sort()
  );
});

test("researchTaskPriorityValues contains exactly critical, high, medium, low", () => {
  assert.deepEqual([...researchTaskPriorityValues].sort(), ["critical", "high", "medium", "low"].sort());
});

test("domainDetectionMethodValues contains exactly provided, detected, fallback", () => {
  assert.deepEqual([...domainDetectionMethodValues].sort(), ["provided", "detected", "fallback"].sort());
});

for (const domain of researchDomainValues) {
  test(`domain "${domain}": tasks match the exact required topic list, in the exact required order`, () => {
    const { tasks } = runDynamicResearchPlanner({ detectedDomain: domain });

    assert.deepEqual(tasks.map((task) => task.topic), EXPECTED_TOPICS_BY_DOMAIN[domain]);
    assert.deepEqual(
      tasks.map((task) => task.order),
      EXPECTED_TOPICS_BY_DOMAIN[domain].map((_, index) => index + 1)
    );
  });

  test(`domain "${domain}": every task has a valid priority, non-empty requiredEvidence, a confidence target matching its priority, and a positive estimated cost`, () => {
    const { tasks } = runDynamicResearchPlanner({ detectedDomain: domain });

    for (const task of tasks) {
      assert.equal(researchTaskSchema.safeParse(task).success, true);
      assert.ok(researchTaskPriorityValues.includes(task.priority));
      assert.ok(task.requiredEvidence.length >= 2);
      assert.equal(task.confidenceTarget, PRIORITY_CONFIDENCE_TARGET[task.priority]);
      assert.ok(task.estimatedCostUsd > 0);
      assert.equal(task.domain, domain);
    }
  });

  test(`domain "${domain}": the full planner result is schema-valid`, () => {
    const result = runDynamicResearchPlanner({ detectedDomain: domain });
    assert.equal(dynamicResearchPlannerResultSchema.safeParse(result).success, true);
  });
}

test("totalEstimatedCostUsd always equals the sum of every task's estimatedCostUsd", () => {
  for (const domain of researchDomainValues) {
    const { tasks, totalEstimatedCostUsd } = runDynamicResearchPlanner({ detectedDomain: domain });
    const expectedTotal = Math.round(tasks.reduce((sum, task) => sum + task.estimatedCostUsd, 0) * 100) / 100;
    assert.equal(totalEstimatedCostUsd, expectedTotal);
  }
});

test("an explicitly provided detectedDomain is trusted as-is: method is 'provided', confidence is 1, and the domain is used even if the prompt suggests a different one", () => {
  const result = runDynamicResearchPlanner({
    detectedDomain: "legal",
    prompt: BUSINESS_PROMPT,
  });

  assert.equal(result.detectedDomain, "legal");
  assert.equal(result.domainConfidence, 1);
  assert.equal(result.domainDetectionMethod, "provided");
  assert.deepEqual(result.tasks.map((task) => task.topic), EXPECTED_TOPICS_BY_DOMAIN.legal);
});

test("a business-like prompt with no explicit domain is auto-detected as business with non-zero confidence", () => {
  const result = runDynamicResearchPlanner({ prompt: BUSINESS_PROMPT });

  assert.equal(result.detectedDomain, "business");
  assert.equal(result.domainDetectionMethod, "detected");
  assert.ok(result.domainConfidence > 0);
});

test("a legal-sounding prompt is auto-detected as legal", () => {
  const result = runDynamicResearchPlanner({ prompt: LEGAL_PROMPT });
  assert.equal(result.detectedDomain, "legal");
  assert.equal(result.domainDetectionMethod, "detected");
});

test("a real-estate-sounding prompt is auto-detected as real_estate", () => {
  const result = runDynamicResearchPlanner({ prompt: REAL_ESTATE_PROMPT });
  assert.equal(result.detectedDomain, "real_estate");
});

test("a finance-sounding prompt is auto-detected as finance", () => {
  const result = runDynamicResearchPlanner({ prompt: FINANCE_PROMPT });
  assert.equal(result.detectedDomain, "finance");
});

test("a healthcare-sounding prompt is auto-detected as healthcare", () => {
  const result = runDynamicResearchPlanner({ prompt: HEALTHCARE_PROMPT });
  assert.equal(result.detectedDomain, "healthcare");
});

test("an engineering-sounding prompt is auto-detected as engineering", () => {
  const result = runDynamicResearchPlanner({ prompt: ENGINEERING_PROMPT });
  assert.equal(result.detectedDomain, "engineering");
});

test("attachmentText contributes to domain detection just like the prompt", () => {
  const result = runDynamicResearchPlanner({
    prompt: "Please look into this.",
    attachmentText: [LEGAL_PROMPT],
  });
  assert.equal(result.detectedDomain, "legal");
});

test("with no prompt, no attachments, and no provided domain, the planner falls back to business with confidence 0 rather than guessing confidently", () => {
  const result = runDynamicResearchPlanner({});

  assert.equal(result.detectedDomain, "business");
  assert.equal(result.domainConfidence, 0);
  assert.equal(result.domainDetectionMethod, "fallback");
  assert.ok(result.planTrace.some((line) => /low-confidence/i.test(line)));
});

test("whichever domain has strictly more distinct keyword hits wins when a prompt mixes signals from two domains", () => {
  const mixedPrompt = `${LEGAL_PROMPT} ${LEGAL_PROMPT} We also might build a business idea around this eventually.`;
  const result = runDynamicResearchPlanner({ prompt: mixedPrompt });
  assert.equal(result.detectedDomain, "legal");
});

test("identical input always produces an identical plan (determinism)", () => {
  const input = { prompt: FINANCE_PROMPT };
  const resultA = runDynamicResearchPlanner(input);
  const resultB = runDynamicResearchPlanner(input);
  assert.deepEqual(resultA, resultB);
});

test("planTrace is non-empty and reports the detected domain, task count, and total cost", () => {
  const result = runDynamicResearchPlanner({ prompt: BUSINESS_PROMPT });

  assert.ok(result.planTrace.length > 0);
  assert.ok(result.planTrace.some((line) => line.includes("business")));
  assert.ok(result.planTrace.some((line) => /task/i.test(line)));
  assert.ok(result.planTrace.some((line) => line.includes(String(result.totalEstimatedCostUsd))));
});

test("task ids are unique, stable, and match the required lowercase-with-underscores identifier shape", () => {
  for (const domain of researchDomainValues) {
    const { tasks } = runDynamicResearchPlanner({ detectedDomain: domain });
    const ids = tasks.map((task) => task.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate ids found for domain ${domain}`);
    for (const id of ids) {
      assert.match(id, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
      assert.ok(id.startsWith(`${domain}_`));
    }
  }
});

test("does not modify report generation, PDF generation, billing, UI, or the production research/report planners, and is not wired into the /api/plan route", async () => {
  assert.doesNotMatch(
    plannerSource,
    /from ["'].*(?:pdf-engine|report-engine|report-jobs|billing|auth)/i
  );
  assert.doesNotMatch(plannerSource, /from ["'].*dynamic-research-plan(?!ner)/);
  assert.doesNotMatch(plannerSource, /from ["'].*dynamic-report-plan/);

  const planRouteSource = await readFile(
    new URL("../app/api/plan/route.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planRouteSource, /dynamic-research-planner|runDynamicResearchPlanner/);

  // intelligence-pipeline.ts is an allowed exception: it is the
  // standalone, feature-flagged connector explicitly built to import and
  // call this planner (ZERINIX Intelligence Pipeline v1). Every other
  // file in app/lib/ai/ must still not reference it, and it must not be
  // wired into the /api/plan route.
  const aiDir = new URL("../app/lib/ai/", import.meta.url);
  const files = await readdir(aiDir);
  for (const file of files) {
    if (file === "dynamic-research-planner.ts" || file === "intelligence-pipeline.ts" || !file.endsWith(".ts")) {
      continue;
    }
    const contents = await readFile(new URL(file, aiDir), "utf8");
    assert.doesNotMatch(
      contents,
      /dynamic-research-planner|runDynamicResearchPlanner/,
      `expected ${file} to not reference the standalone planner`
    );
  }
});
