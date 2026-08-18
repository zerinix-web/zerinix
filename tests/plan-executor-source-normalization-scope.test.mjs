import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { normalizeReportSourceSection } from "../app/lib/report-source-normalization.mjs";

// Reproduces a real, confirmed production bug found via live report
// generation across multiple industries and both languages:
// normalizeReportSourceSection (via its internal normalizeEvidenceLabels)
// deliberately reverse-maps clean, user-facing evidence-provenance
// phrasing back to the raw internal classification vocabulary:
//   "Planning Assumption" -> "Assumption"
//   "Benchmark Derived"   -> "Estimated"
//   "Validation Required" -> "AI Analysis"
// That is the CORRECT, intentional pre-processing step for the sources
// section specifically (buildEvidenceSummary's own downstream consumer
// expects that canonical vocabulary) -- but enforcePlanReportLanguage
// used to run this same function, via cleanInternalSourceFallbacks, on
// EVERY plan field, not just sourcesAssumptions. Two concrete failures
// this caused, both captured verbatim from live gpt-5-mini output:
//   - A deterministic SWOT bullet correctly read "...16.4 months payback
//     is still a planning assumption until acquisition channels are
//     tested." and came out "...is still a Assumption..." -- the exact
//     substring "Planning Assumption" (case-insensitive) got stripped
//     down to "Assumption" mid-sentence, reintroducing the very banned
//     tag this whole pipeline works to keep out of user-facing text.
//   - "(AI Planning Assumption)" (a Financial Warnings evidence-type
//     label) became "(AI Assumption)" for the same reason.
// The fix scopes the reverse-mapping to the two call sites that are
// actually processing sourcesAssumptions and gives every other field a
// lighter cleanup (stripInternalPlaceholderArtifacts) that only removes
// literal broken-interpolation artifacts, never real prose.

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

test("normalizeReportSourceSection really does reverse-map clean labels to raw internal tags (documents why it must be scoped)", () => {
  const swotSentence =
    "- 16.4 months payback is still a planning assumption until acquisition channels are tested.";
  const out = normalizeReportSourceSection(swotSentence, {
    language: "English",
    allowExternalCitations: false,
  });

  // This assertion documents the function's actual, intentional behavior
  // for source-section content -- it is not itself the bug. The bug was
  // calling this function on non-source content at all.
  assert.match(out, /is still a Assumption/);

  const financialWarningLine = "- Capital efficiency requires validation. (AI Planning Assumption)";
  const out2 = normalizeReportSourceSection(financialWarningLine, {
    language: "English",
    allowExternalCitations: false,
  });
  assert.match(out2, /\(AI Assumption\)/);
});

test("enforcePlanReportLanguage no longer runs the source-label reverse-mapping on every field (drift check)", () => {
  assert.ok(
    planExecutorSource.includes(
      "let normalized = stripInternalPlaceholderArtifacts(content, language);"
    ),
    "enforcePlanReportLanguage must use the scoped-down artifact cleanup, not the full source-section normalizer"
  );
  assert.ok(
    !planExecutorSource.includes(
      "let normalized = cleanInternalSourceFallbacks(content, language);"
    ),
    "enforcePlanReportLanguage must not call the full source-section normalizer universally"
  );
  // The full normalizer must still be reserved for genuine sourcesAssumptions
  // processing -- these two call sites are expected to remain.
  const cleanInternalSourceFallbacksCallCount = (
    planExecutorSource.match(/cleanInternalSourceFallbacks\(/g) || []
  ).length;
  // 1 function definition + 2 real call sites (createPlanFieldFallback's
  // sourcesAssumptions branch, and the direct sourcesAssumptions
  // assignment) = 3 occurrences of the identifier in the source.
  assert.equal(
    cleanInternalSourceFallbacksCallCount,
    3,
    "cleanInternalSourceFallbacks call-site count changed -- verify it is still scoped to sourcesAssumptions only"
  );
});

test("stripInternalPlaceholderArtifacts (the universal per-field cleanup) never touches evidence-provenance vocabulary (drift check)", () => {
  assert.ok(
    planExecutorSource.includes("function stripInternalPlaceholderArtifacts("),
    "stripInternalPlaceholderArtifacts is missing from plan-executor.ts"
  );
  const fnMatch = /function stripInternalPlaceholderArtifacts\(content: string, language: ResponseLanguage\) \{([\s\S]*?)\n\}/.exec(
    planExecutorSource
  );
  assert.ok(fnMatch, "could not locate stripInternalPlaceholderArtifacts body");
  const body = fnMatch[1];
  // The function may legitimately use "Planning assumption" as its own
  // clean OUTPUT text (the placeholder replacement string) -- what it
  // must never do is reverse-map that phrase (or Benchmark Derived /
  // Validation Required) back down to a raw tag via a .replace() whose
  // SOURCE pattern is one of those phrases.
  assert.doesNotMatch(body, /\.replace\(\/[^)]*Planning Assumption/i);
  assert.doesNotMatch(body, /\.replace\(\/[^)]*Benchmark Derived/i);
  assert.doesNotMatch(body, /\.replace\(\/[^)]*Validation Required/i);
  assert.ok(!body.includes("normalizeReportSourceSection("), "must not call the full source-section normalizer");
});
