import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces a real, confirmed production defect: "I have 1 million USD to
// invest. Instead of giving me one recommendation, propose three completely
// different business ideas from completely different industries. Then
// generate a full business idea validation report for each idea and
// finally compare them." was fed straight into
// createCanonicalFinancialAssumptions/createReportBusinessDescription as if
// it WERE a concrete business description. No industry/product keyword in
// it matches anything, so the financial model fell back to its generic
// "services" bucket (displayed as "Unspecified business model"), the
// mechanical description extractor collapsed to a placeholder (it contains
// the word "report"), and the model itself was asked to write a report
// about a placeholder, correctly returning nothing for most narrative
// fields -- which is what actually produced the wall of "not provided;
// cannot be calculated from available evidence" fallback text, not a
// report-writing failure.
//
// Tested via source assertions (matching this codebase's established
// convention for plan-executor.ts, which has heavy Supabase/auth
// dependencies that prevent clean direct import -- see
// plan-executor-billing-orthogonality.test.mjs) plus a faithful mirror of
// the real detection regexes, copied verbatim from the source below each
// assertion that depends on them, so this test actually exercises the
// matching behavior rather than only confirming the code exists.

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

test("resolveConcreteBusinessIdeaForPlan exists and is wired in before the financial model, the business description, and the research query", () => {
  assert.match(planExecutorSource, /async function resolveConcreteBusinessIdeaForPlan\(/);
  assert.match(planExecutorSource, /function promptLacksConcreteBusinessIdea\(/);

  // Must run, and its result must be used, before createCanonicalFinancialAssumptions
  const resolutionCallIndex = planExecutorSource.indexOf("const resolvedBusinessIdea = await resolveConcreteBusinessIdeaForPlan(");
  const financialAssumptionsIndex = planExecutorSource.indexOf("const canonicalFinancialAssumptions = createCanonicalFinancialAssumptions({\n      prompt: resolvedAnalysisPrompt,");
  assert.ok(resolutionCallIndex >= 0, "expected resolveConcreteBusinessIdeaForPlan to be called");
  assert.ok(financialAssumptionsIndex >= 0, "expected createCanonicalFinancialAssumptions to be built from resolvedAnalysisPrompt, not the raw prompt");
  assert.ok(resolutionCallIndex < financialAssumptionsIndex, "idea resolution must run before the financial model is built from it");

  // The mechanical business-description extractor must also read the
  // resolved idea, not the raw, possibly-ambiguous prompt.
  assert.match(planExecutorSource, /createReportBusinessDescription\(resolvedAnalysisPrompt\)/);

  // The research/evidence-gathering phase (Competitor Landscape/ICP's real
  // source of grounding) must search for the resolved idea, not the raw
  // meta-request -- confirmed live this was still broken even after fixing
  // only the report-writing prompt, since research runs from a separately
  // captured "prompt" field.
  assert.match(planExecutorSource, /prompt:\s*resolvedAnalysisPrompt,\n[\s\S]{0,40}assets: analysisAssets,/);
});

test("resolveConcreteBusinessIdeaForPlan degrades gracefully to the original prompt on any failure (never breaks report generation)", () => {
  const start = planExecutorSource.indexOf("async function resolveConcreteBusinessIdeaForPlan(");
  const end = planExecutorSource.indexOf("\n}\n", start);
  const body = planExecutorSource.slice(start, end);

  assert.match(body, /catch \(error\)/);
  // Every early-return and the catch block must all resolve back to the
  // original prompt, never throw, never leave resolvedPrompt undefined.
  const earlyReturns = body.match(/return \{ resolvedPrompt: prompt, wasGenerated: false \};/g) || [];
  assert.ok(earlyReturns.length >= 3, `expected multiple graceful fallback paths (empty/failed response, missing fields, and the catch block), found ${earlyReturns.length}`);
});

test("resolveConcreteBusinessIdeaForPlan is billed/routed through the centralized model router, not an ad hoc model choice", () => {
  const start = planExecutorSource.indexOf("async function resolveConcreteBusinessIdeaForPlan(");
  const end = planExecutorSource.indexOf("\n}\n", start);
  const body = planExecutorSource.slice(start, end);

  assert.match(body, /resolveAiModelForRequestKind\("business_advice"\)/);
  assert.match(body, /withOpenAiCostOperation\(/);
});

// Faithful mirror of the real detection regexes in
// plan-executor.ts -- kept in sync manually; if the source patterns
// change, update both here and there.
const businessIdeaGenerationRequestPattern =
  /\b(propose|suggest|generate|come up with|recommend|give me)\b[\s\S]{0,80}\b(business |startup |venture |company )?ideas?\b/i;
const newVentureProposalPattern =
  /\b(?:suggest|propose|recommend|give me)\b\s+(?:a |an |some )?(?:good |great |strong |profitable |new |viable )*(?:business|startup|venture|company)\b\s+(?:to (?:start|launch|build|create|run)|(?:i|we) (?:could|should|can) start)/i;
const multipleDistinctIdeasPattern =
  /\b(three|3|multiple|several|a few|different)\b[\s\S]{0,60}\b(different )?(business |startup |venture |industr(?:y|ies) )?ideas?\b/i;
const businessQuestionPreamblePattern =
  /\b(would you invest|should i invest|should i start|is it worth|is it sensible to|does it make sense to|what do you think about|what do you think of)\b/gi;

function promptRequestsBusinessIdeaGeneration(prompt) {
  return (
    businessIdeaGenerationRequestPattern.test(prompt) ||
    newVentureProposalPattern.test(prompt) ||
    multipleDistinctIdeasPattern.test(prompt)
  );
}

function promptLacksConcreteBusinessIdea(prompt) {
  const trimmed = prompt.trim();
  if (!trimmed) return true;
  if (promptRequestsBusinessIdeaGeneration(trimmed)) return true;

  const withoutPreamble = trimmed
    .replace(businessQuestionPreamblePattern, " ")
    .replace(/\s+/g, " ")
    .trim();
  const substantiveWordCount = withoutPreamble.split(/\s+/).filter(Boolean).length;

  return substantiveWordCount < 8;
}

test("mirrored detection patterns are present verbatim in the source (catches drift between this test and the real implementation)", () => {
  assert.ok(
    planExecutorSource.includes(businessIdeaGenerationRequestPattern.source),
    "businessIdeaGenerationRequestPattern source text has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(newVentureProposalPattern.source),
    "newVentureProposalPattern source text has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(multipleDistinctIdeasPattern.source),
    "multipleDistinctIdeasPattern source text has diverged from plan-executor.ts"
  );
});

test("the exact reported bug prompt is detected as lacking a concrete business idea", () => {
  const bugPrompt =
    "I have 1 million USD to invest. Instead of giving me one recommendation, propose three completely different business ideas from completely different industries. Then generate a full business idea validation report for each idea and finally compare them.";
  assert.equal(promptLacksConcreteBusinessIdea(bugPrompt), true);
});

test("a genuinely vague prompt with no business content is also detected", () => {
  assert.equal(promptLacksConcreteBusinessIdea("Should I start a business?"), true);
  assert.equal(promptLacksConcreteBusinessIdea(""), true);
  assert.equal(promptLacksConcreteBusinessIdea("Give me a business idea for a $50k budget."), true);
  assert.equal(promptLacksConcreteBusinessIdea("Suggest a good business to start in the fitness industry."), true);
});

test("a prompt that already names a concrete, specific business is left alone, even when phrased as a question", () => {
  // The pre-existing bug: createReportBusinessDescription's own "should i
  // invest" check discarded this exact real, specific business description
  // purely because of the question framing, even though it names a precise
  // idea, capital amount, and location.
  assert.equal(
    promptLacksConcreteBusinessIdea(
      "Should I invest 2 million dollars into a 3D-printed metal aerospace parts manufacturing startup based in Ohio?"
    ),
    false
  );
  assert.equal(
    promptLacksConcreteBusinessIdea(
      "A subscription-based AI copilot that helps small law firms review and redline commercial contracts."
    ),
    false
  );
  assert.equal(
    promptLacksConcreteBusinessIdea(
      "A direct-to-consumer monthly subscription box for eco-friendly, zero-waste cleaning products."
    ),
    false
  );
  assert.equal(
    promptLacksConcreteBusinessIdea(
      "An online coding bootcamp platform targeting career-changers in Southeast Asia, with job-placement guarantees."
    ),
    false
  );
  assert.equal(
    promptLacksConcreteBusinessIdea(
      "Recommend improvements to my existing SaaS pricing page copywriting business focused on B2B startups."
    ),
    false
  );
});
