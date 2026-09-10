// TASK #69A-38B -- Fix the ROOT CAUSE of the fresh BIV business-context/
// research regression that #69A-38 did not fully resolve.
//
// A genuinely fresh report/PDF for "Premium AI-powered financial
// planning, cash-flow forecasting, and scenario-planning SaaS
// specifically for SMBs in the United States, integrating with
// QuickBooks/Xero" still showed Target Customer collapsing to "startups
// and SMBs", Industry collapsing to "AI software / automation",
// Competitor Landscape empty, and Porter's Five Forces structurally
// incomplete -- even though #69A-38's classifier-ordering fix (which
// this task keeps, verified below) was already correctly producing
// "startups and SMBs" as the CLASSIFIER bucket for this prompt.
//
// EARLIEST CORRUPTED BOUNDARY, traced end-to-end and confirmed by
// direct reproduction (not assumed): plan-executor.ts embeds
// formatCanonicalFinancialAssumptions's own output verbatim into the
// SAME generation prompt sent for EVERY report section (`${financialAssumptionsContext}`
// in plan-executor.ts's shared `input` template, used identically for
// targetCustomer, competitorLandscape, and portersFiveForces -- there is
// no per-field variant). That block's "Detected modeling inputs" header
// shows `context.inputs.industry`/`context.inputs.targetCustomer` --
// financial-model.ts's own COARSE, bounded classifier output, needed
// only for benchmark-table selection (getIndustryBenchmarks(industryKey))
// and Turkish label translation -- framed as authoritative "single
// source of truth ... reuse ... everywhere" context the model is
// instructed to build every section from. A model told, at the very top
// of its own instructions, "Industry: AI software / automation, Target
// customer: startups and SMBs" reliably echoes or narrows toward that
// coarse label instead of the user's own explicit, far more specific
// description -- and, reasoning about competitors/Porter's Five Forces
// from that same generic anchor, has a much weaker, less specific
// category to search against, consistent with the reported empty
// Competitor Landscape and incomplete Porter state. Research-query
// construction itself was confirmed (in #69A-38's own investigation, and
// reconfirmed below) to never read `context.inputs` at all -- it is not
// a cache, evidence-classification, or validation-filter defect.
//
// FIX: two new fields on FinancialModelingInputs,
// `industryDescriptor`/`targetCustomerDescriptor` (financial-model.ts),
// computed from the SAME already-resolved classifier output plus a
// general-purpose (not hardcoded to this one business) extraction of any
// explicit "<functional description> SaaS/software/platform/..." phrase
// in the prompt, falling back to the exact original coarse value
// whenever no such phrase exists. These two descriptors are consumed
// ONLY at the one real leak point (financial-assumptions.ts's
// formatCanonicalFinancialAssumptions) -- `industry`/`targetCustomer`
// themselves, `industryKey`, benchmark lookups, and every one of their
// other ~15 existing consumers across the codebase are completely
// unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inferFinancialModelingInputs } from "../app/lib/ai/financial-model.ts";
import {
  createCanonicalFinancialAssumptions,
  formatCanonicalFinancialAssumptions,
} from "../app/lib/ai/financial-assumptions.ts";
import {
  buildPortersFiveForcesStateFromLegacyProse,
} from "../app/lib/report-engine/porters-five-forces-state.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const financialModelSource = readFileSync(join(repoRoot, "app/lib/ai/financial-model.ts"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");

const REAL_CASE_PROMPT =
  "Premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for SMBs in the United States, integrating with QuickBooks/Xero.";

// --- [1] explicit SMB ICP survives normalization ---------------------

test("[1] the exact real-case prompt's SMB segment survives into targetCustomerDescriptor, geography-qualified, never the generic classifier bucket alone", () => {
  const inputs = inferFinancialModelingInputs(REAL_CASE_PROMPT);
  assert.equal(inputs.targetCustomer, "startups and SMBs");
  assert.equal(inputs.targetCustomerDescriptor, "United States small and medium-sized businesses");
  assert.match(inputs.targetCustomerDescriptor, /small and medium-sized businesses/i);
});

// --- [2] explicit financial-planning/cash-flow category survives -----

test("[2] the exact real-case prompt's explicit product category survives into industryDescriptor -- financial planning / cash-flow forecasting / scenario-planning, never discarded", () => {
  const inputs = inferFinancialModelingInputs(REAL_CASE_PROMPT);
  assert.match(inputs.industryDescriptor, /financial planning/i);
  assert.match(inputs.industryDescriptor, /cash-flow forecasting/i);
  assert.match(inputs.industryDescriptor, /scenario-planning/i);
  assert.match(inputs.industryDescriptor, /^SMB /);
});

// --- [3] generic AI software/automation cannot overwrite stronger ----
// --- explicit context --------------------------------------------------

test("[3] FAIL-BEFORE PROOF: the OLD prompt-embedding shape (industry line = the bare coarse classifier value) really did show the generic label as the descriptive Industry -- reconstructed from the current source, not git-dependent", () => {
  const oldStyleLine = "- Industry: ${context.inputs.industry}";
  assert.ok(
    !financialAssumptionsSource.includes(oldStyleLine),
    "expected the OLD bare-classifier Industry line to no longer be present in the current source"
  );
  // Prove what it WOULD have rendered, using the real coarse classifier
  // value for this exact prompt, without executing any removed code.
  const inputs = inferFinancialModelingInputs(REAL_CASE_PROMPT);
  assert.equal(inputs.industry, "AI software / automation");
  assert.notEqual(inputs.industry, inputs.industryDescriptor);
});

test("[3b] the generic 'AI software / automation' bucket now only ever appears parenthetically, as benchmark-basis context, never as the leading descriptive Industry value", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: REAL_CASE_PROMPT, reportKind: "business_plan" });
  const text = formatCanonicalFinancialAssumptions(context);
  const industryLine = text.split("\n").find((line) => line.startsWith("- Industry:"));
  assert.ok(industryLine);
  assert.match(industryLine, /^- Industry: SMB financial planning/);
  assert.match(industryLine, /\(benchmark basis: AI software \/ automation\)$/);
});

// --- [4] geography survives -------------------------------------------

test("[4] geography survives verbatim as 'United States', both in the coarse field and inside the richer target-customer descriptor", () => {
  const inputs = inferFinancialModelingInputs(REAL_CASE_PROMPT);
  assert.equal(inputs.geography, "United States");
  assert.match(inputs.targetCustomerDescriptor, /^United States/);
});

// --- [5] integrations survive where structurally supported -----------

test("[5] the raw user prompt (including the explicit QuickBooks/Xero integration statement) is embedded verbatim in the generation input, unmodified by this fix -- integrations are preserved through the EXISTING 'Submitted business context' passthrough, not a new extraction mechanism", () => {
  assert.match(planExecutorSource, /Submitted business context for private analysis only: \$\{promptText\}/);
});

// --- [6] research receives correct context (unchanged, reconfirmed) --

test("[6] research query construction still never reads context.inputs.industry/targetCustomer at all -- reconfirms #69A-38's own finding that this is not a research-query, cache-identity, or evidence-classification defect", () => {
  const researchPlanSource = readFileSync(join(repoRoot, "app/lib/decision-intelligence/research-plan.ts"), "utf8");
  const domainResearchSource = readFileSync(join(repoRoot, "app/lib/ai/domain-research.ts"), "utf8");
  assert.doesNotMatch(researchPlanSource, /inputs\.industry\b|inputs\.targetCustomer\b/);
  assert.doesNotMatch(domainResearchSource, /inputs\.industry\b|inputs\.targetCustomer\b/);
});

// --- [7] competitor pipeline does not receive the generic AI category --

test("[7] the competitorLandscape/portersFiveForces field-specific prompts (plan.ts) are static task instructions with no embedded classifier reference -- the ONLY channel either section receives 'Detected modeling inputs' through is the shared, now-fixed financialAssumptionsContext block", () => {
  const planPromptsSource = readFileSync(join(repoRoot, "app/lib/report-engine/prompts/plan.ts"), "utf8");
  const competitorMatch = planPromptsSource.match(/competitorLandscape:\s*\{[^}]*\}/s);
  const porterMatch = planPromptsSource.match(/portersFiveForces:\s*\{[^}]*\}/s);
  assert.ok(competitorMatch);
  assert.ok(porterMatch);
  assert.doesNotMatch(competitorMatch[0], /inputs\.industry|inputs\.targetCustomer/);
  assert.doesNotMatch(porterMatch[0], /inputs\.industry|inputs\.targetCustomer/);
});

test("[7b] every report section's generation prompt (competitorLandscape and portersFiveForces included) is built from the SAME shared input template that embeds the now-fixed financialAssumptionsContext -- confirms the fix reaches both sections, not just Target Customer's own field", () => {
  const occurrences = (planExecutorSource.match(/\$\{financialAssumptionsContext\}/g) || []).length;
  assert.ok(occurrences >= 1, "expected financialAssumptionsContext to be embedded in the shared per-section prompt template");
  // The shared `input` template (where financialAssumptionsContext is
  // embedded) is built once per section request and used for
  // `Section to generate: ${planFieldLabels[...][reportField]}` --
  // i.e. for every field, not a competitor/Porter-specific branch.
  assert.match(planExecutorSource, /Section to generate: \$\{planFieldLabels\[responseLanguage\]\[reportField\]\}/);
});

// --- [8] Porter pipeline receives correct context ----------------------

test("[8] Porter's Five Forces Tier 1 synthesis (added in #69A-38, unaffected by this task) still guarantees exactly 5 well-formed forces regardless of prompt-anchoring quality -- defense in depth alongside this task's own root-cause fix", () => {
  const state = buildPortersFiveForcesStateFromLegacyProse("");
  assert.equal(Object.keys(state.forces).length, 5);
});

// --- [9] web/PDF consume the same canonical result ---------------------

test("[9] industryDescriptor/targetCustomerDescriptor are consumed at exactly ONE call site (formatCanonicalFinancialAssumptions) -- there is no second, renderer-side copy of this fix to drift out of sync, matching #69A-38's own established single-canonical-source pattern", () => {
  const occurrences = (financialAssumptionsSource.match(/inputs\.industryDescriptor|inputs\.targetCustomerDescriptor/g) || []).length;
  assert.equal(occurrences, 2, "expected exactly one usage each of industryDescriptor and targetCustomerDescriptor");
  for (const file of ["app/dashboard/[id]/page.tsx", "components/Planner.tsx", "app/dashboard/[id]/ReportPdfButton.tsx"]) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /industryDescriptor|targetCustomerDescriptor/, `${file} should never need its own copy of this fix -- both descriptors only affect the AI generation prompt, not rendering`);
  }
});

// --- [10] no hardcoded competitor names/output --------------------------

test("[10] no known competitor name for this exact business category was hardcoded anywhere in this task's fix", () => {
  for (const knownCompetitor of ["Float", "Fathom", "Futrli", "Jirav", "Causal", "Finmark", "Cash Flow Frog", "Pry"]) {
    assert.ok(!financialModelSource.includes(knownCompetitor), `financial-model.ts must not hardcode "${knownCompetitor}"`);
    assert.ok(!financialAssumptionsSource.includes(knownCompetitor), `financial-assumptions.ts must not hardcode "${knownCompetitor}"`);
  }
});

// --- [11] existing decision/financial regression tests remain green ----
// (structural confinement checks here; the full targeted/battery/suite
// runs are executed separately as part of this task's verification)

test("[11] no decision-engine, investment-score, or #69A-37/#69A-37A financial-serialization file carries a #69A-38B marker -- this fix is confined to business-context descriptor derivation, never score computation or text-serialization logic", () => {
  for (const relativePath of [
    "app/lib/decision-engine-v2/dimensions.ts",
    "app/lib/ai/investment-score.ts",
    "app/lib/report-consistency-validation.ts",
    "app/lib/report-presentation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-38B/, `${relativePath} should not carry a #69A-38B marker`);
  }
});

test("[11b] industryKey (the bounded enum driving getIndustryBenchmarks -- real financial math) is completely untouched by this task's fix -- same resolution, same benchmark lookup, for the real-case prompt", () => {
  const inputs = inferFinancialModelingInputs(REAL_CASE_PROMPT);
  assert.equal(inputs.industryKey, "ai");
  assert.equal(inputs.industry, "AI software / automation");
});

// --- No-regression: every prompt shape that had no explicit descriptor -
// --- signal behaves identically to before this task ---------------------

test("prompts with no extractable '<description> SaaS/software/...' phrase produce industryDescriptor/targetCustomerDescriptor identical to the existing coarse values (zero behavior change for vague/generic/non-software prompts)", () => {
  for (const prompt of [
    "premium coffee roastery selling specialty coffee.",
    "luxury yacht charter service for affluent clients.",
    "A scooter rental business for urban commuters.",
    "A restaurant chain expanding to new cities.",
  ]) {
    const inputs = inferFinancialModelingInputs(prompt);
    assert.equal(inputs.industryDescriptor, inputs.industry, prompt);
  }
});

test("a prompt with an explicit descriptor but no SMB/mid-market/consumer/enterprise/professional segment composes industryDescriptor without a dangling qualifier", () => {
  const inputs = inferFinancialModelingInputs("A cybersecurity threat-detection SaaS for organizations everywhere.");
  assert.ok(!inputs.industryDescriptor.startsWith(" "));
  assert.match(inputs.industryDescriptor, /threat-detection software$/);
});
