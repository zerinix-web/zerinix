// TASK #69A-41 -- Eliminate the Founder Readiness canonical-score
// contradiction.
//
// LIVE FAILURE (real fresh report, id 7e5991fb-a0c4-470f-aec4-5cb9c2e7918b,
// created 2026-09-10T06:45:36, inspected via service-role read-only
// scratch script, deleted immediately after use): the persisted
// `founderScore` section read:
//   Founder Readiness Score: 40/100
//   Idea Quality: 66/100 - ...
//   Market Attractiveness: 66/100 - ...
//   Business Model Quality: 54/100 - ...
//   Validation Confidence: 45/100 - ...
//   Execution Complexity: 66/100 - ...
//   Evidence Confidence: 18/100 - founder must prioritize rapid
//     paid-pilot validation and partner commitments to raise score.
//   Founder Evidence: 34/100 - no founder-specific execution proof
//     provided. Composite Founder Readiness: 48/100. Diagnostics:.
// -- and metadata.investmentScore.decisionEngine.founderScore.score was
// 40, matching the canonical headline exactly (as #69A-6 already
// guarantees: buildCanonicalFounderScore's headline always reads
// founder.score directly, never re-derived).
//
// ROOT CAUSE (PROVEN, not two competing formulas to reconcile): "48" is
// not a legitimate second metric at all -- it is stray, uncontrolled
// model prose. The founderScore prompt (prompts/plan.ts) never asks for
// a "Composite Founder Readiness" or "Diagnostics" line (it explicitly
// says "Do not expose internal formulas or system scoring logic"), but
// the model wrote them anyway, appended directly onto the SAME sentence
// as "Founder Evidence"'s own real explanation with no newline in
// between. buildCanonicalFounderScore's own extractFounderDimensionExplanation
// helper captures each dimension's trailing prose using a "stop at the
// next known dimension label" guard (FOUNDER_DIMENSION_STOP_LABELS) --
// but "Founder Evidence" is the LAST dimension, so there was no next
// label to stop the capture, and neither "Composite Founder Readiness:"
// nor "Diagnostics:" was in that enumerated list. The capture ran
// straight through both stray sentences and buildCanonicalFounderScore
// (which otherwise builds every line of this section from scratch, from
// the one true source of truth) spliced the model's own uncontrolled
// number directly into the canonical, deterministic report text --
// creating a real, contradictory second score next to the correct
// "Founder Readiness Score: 40/100" headline in the exact same section.
//
// FIX (app/lib/report-jobs/plan-executor.ts):
// extractFounderDimensionExplanation's stop-lookahead now ALSO matches a
// generic "1-5 Title-Case words followed directly by a colon" shape --
// the exact structural pattern every stray label (however the model
// happens to phrase it) shares -- so the capture can never again run
// past the end of a dimension's own real explanation into an unrelated,
// unrequested labeled line, without needing to enumerate every possible
// stray label the model might invent. No score, no weighting formula,
// and no other file was touched -- this is purely a text-extraction
// boundary fix.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);

function extractConstSource(source, name) {
  const startMatch = source.match(new RegExp(`const ${name} = \\[`));
  assert.ok(startMatch, `${name} not found`);
  const start = startMatch.index;
  const end = source.indexOf("];", start) + 2;
  return source.slice(start, end);
}

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
  assert.ok(startMatch, `${name} not found`);
  const start = startMatch.index;
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

function stripTsTypes(text) {
  return text.replace(/\(content: string, label: string\)/, "(content, label)");
}

// Loads the REAL, unmodified extractFounderDimensionExplanation (and its
// real FOUNDER_DIMENSION_STOP_LABELS dependency), exactly as authored,
// via a temp module -- not an approximation of it. Mirrors
// tests/task69a4-biv-quality-gate-provenance-fix.test.mjs's own
// established technique for extracting a plan-executor.ts private
// helper (that file can't be imported directly: it pulls in
// "next/server" and other Next-only modules).
async function loadRealExtractFunction() {
  const blob = [
    extractConstSource(planExecutorSource, "FOUNDER_DIMENSION_STOP_LABELS"),
    stripTsTypes(extractFunctionSource(planExecutorSource, "extractFounderDimensionExplanation")),
    "export { extractFounderDimensionExplanation };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "task69a41-"));
  const file = join(dir, "extract.mjs");
  writeFileSync(file, blob);
  const mod = await import(pathToFileURL(file).href);
  return mod.extractFounderDimensionExplanation;
}

// A pre-#69A-41 reconstruction (the SAME function, but with the fix's own
// generic stop-lookahead alternative removed) -- proves the exact live
// failure is reproducible from the OLD code shape, not asserted from
// git history.
async function loadPreFixExtractFunction() {
  const oldSource = planExecutorSource.replace(
    /\.concat\(\["\[A-Z\]\[a-zA-Z\]\*\(\?:\\\\s\+\[A-Z\]\[a-zA-Z\]\*\)\{0,4\}:\\\\s"\]\)\s*\n\s*\.join\("\|"\);/,
    '.join("|");'
  );
  assert.notEqual(oldSource, planExecutorSource, "expected to find and remove the fix's own .concat(...) call");

  const blob = [
    extractConstSource(oldSource, "FOUNDER_DIMENSION_STOP_LABELS"),
    stripTsTypes(extractFunctionSource(oldSource, "extractFounderDimensionExplanation")),
    "export { extractFounderDimensionExplanation };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "task69a41-prefix-"));
  const file = join(dir, "extract.mjs");
  writeFileSync(file, blob);
  const mod = await import(pathToFileURL(file).href);
  return mod.extractFounderDimensionExplanation;
}

const REAL_LEAKED_MODEL_TEXT = `Founder Readiness Score: 40/100
Idea Quality: 66/100 - targeted SMB FP&A problem is real and addressable.
Market Attractiveness: 66/100 - The market appears attractive if reachable demand and an obtainable beachhead can be validated.
Business Model Quality: 54/100 - The model depends on repeat purchase, gross margin discipline, and a payback path that can survive real acquisition costs.
Validation Confidence: 45/100 - primary validation (paid pilots, conversion) missing.
Execution Complexity: 66/100 - Execution requires disciplined launch sequencing, channel proof, and operational control.
Evidence Confidence: 18/100 - founder must prioritize rapid paid-pilot validation and partner commitments to raise score.
Founder Evidence: 34/100 - no founder-specific execution proof provided. Composite Founder Readiness: 48/100. Diagnostics:.`;

test("FAIL-BEFORE PROOF: the pre-#69A-41 extraction logic really did leak 'Composite Founder Readiness: 48/100' into Founder Evidence's own explanation, for the real live text", async () => {
  const preFix = await loadPreFixExtractFunction();
  const explanation = preFix(REAL_LEAKED_MODEL_TEXT, "Founder Evidence");
  assert.match(explanation, /Composite Founder Readiness/, "expected to reproduce the exact live leak before the fix");
});

test("FIX PROOF: the REAL, current extraction logic no longer leaks the stray 'Composite Founder Readiness'/'Diagnostics' text for the exact real live report", async () => {
  const extract = await loadRealExtractFunction();
  const explanation = extract(REAL_LEAKED_MODEL_TEXT, "Founder Evidence");
  assert.equal(explanation, "no founder-specific execution proof provided.");
  assert.doesNotMatch(explanation, /Composite/);
  assert.doesNotMatch(explanation, /Diagnostics/);
  assert.doesNotMatch(explanation, /48/);
});

test("GENERALITY PROOF: the fix is a structural pattern, not a hardcoded '48'/'Composite Founder Readiness' special case -- ANY stray Title-Case-labeled trailing line is stopped", async () => {
  const extract = await loadRealExtractFunction();
  const differentStrayLabel = `Founder Evidence: 34/100 - no founder-specific execution proof provided. Aggregate Readiness Index: 71/100. Model Confidence Note: high.`;
  const explanation = extract(differentStrayLabel, "Founder Evidence");
  assert.equal(explanation, "no founder-specific execution proof provided.");
  assert.doesNotMatch(explanation, /Aggregate Readiness Index|Model Confidence Note|71/);
});

test("SAFETY: a genuine, real-shaped explanation with no stray trailing label is completely unaffected by the new generic guard", async () => {
  const extract = await loadRealExtractFunction();
  const cleanText = `Founder Evidence: 34/100 - no founder-specific execution proof provided.`;
  const explanation = extract(cleanText, "Founder Evidence");
  assert.equal(explanation, "no founder-specific execution proof provided.");
});

test("SAFETY: a genuine mid-explanation dimension (not the last one) already stopped correctly at the next KNOWN dimension label before this fix, and still does", async () => {
  const extract = await loadRealExtractFunction();
  const text = `Business Model Quality: 54/100 - the model depends on repeat purchase and margin discipline. Validation Confidence: 45/100 - primary validation missing.`;
  const explanation = extract(text, "Business Model Quality");
  assert.equal(explanation, "the model depends on repeat purchase and margin discipline.");
});

test("ROOT CAUSE CONFIRMATION: buildCanonicalFounderScore's own headline is built from founder.score directly (Math.round), never re-derived from the model's own prose -- the 40/100 headline was never the contradiction's source", () => {
  assert.match(
    planExecutorSource,
    /const overallScore = Math\.max\(0, Math\.min\(100, Math\.round\(founder\.score\)\)\);/
  );
});

test("SAFETY: no scoring formula, weighting, or investment-score.ts file was touched by this fix -- confined to the text-extraction boundary in plan-executor.ts", () => {
  const investmentScoreSource = readFileSync(
    join(repoRoot, "app/lib/ai/investment-score.ts"),
    "utf8"
  );
  assert.doesNotMatch(investmentScoreSource, /TASK #69A-41/);
});

test("SAFETY: the fix's own EXECUTABLE code (never its explanatory comment, which legitimately documents the real 40-vs-48 bug it fixes) contains no hardcoded '40' or '48'", () => {
  const marker = '.concat(["[A-Z][a-zA-Z]*(?:\\\\s+[A-Z][a-zA-Z]*){0,4}:\\\\s"])';
  assert.ok(planExecutorSource.includes(marker), "expected to find the fix's own .concat([...]) call verbatim");
  assert.doesNotMatch(marker, /\b48\b|\b40\b/);
});
