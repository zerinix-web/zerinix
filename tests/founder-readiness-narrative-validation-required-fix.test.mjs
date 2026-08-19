import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// CRITICAL PRODUCTION QUALITY FIX -- confirmed live in a carbon-accounting/
// ESG-compliance Business Plan report: the Founder Readiness section's
// user-visible narrative text still showed the internal evidence-
// classification tag verbatim, as a trailing clause inside a dimension's
// own explanation prose:
//
//   "Validation Confidence: 52/100 - primary customer and pricing
//   Validation Required."
//
// Root cause: replaceBareValidationRequiredValue (app/lib/report-jobs/
// plan-executor.ts, the final per-field cleanup pass applied to every
// Business Plan field including founderScore) already replaced the
// Title-Case "Validation Required" tag wherever it appeared, but always
// with the KPI-value phrasing "Not yet measured" -- correct for a card
// value ("Activation: Not yet measured"), but a non sequitur when the tag
// is the tail of a real sentence ("...pricing Not yet measured." reads as
// broken English, not a fix). The tag can appear in two genuinely
// different shapes that need different treatment:
//   1. VALUE-style: immediately after a bare "Label:"/"Label-" separator
//      with nothing else in between (a KPI card's own value/status) --
//      "Not yet measured" is correct here.
//   2. PROSE-trailing: the tag ends a real, otherwise-complete sentence
//      ("...pricing Validation Required.") -- "requires validation"
//      completes it as natural English instead.
// Ordinary lowercase prose that continues past the tag ("further
// validation required before scaling") is neither shape and must stay
// untouched -- it already reads as normal English, not a placeholder.

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

// Mirrors the real implementation exactly (plan-executor.ts has heavy
// Supabase/auth dependencies that prevent clean direct import --
// established convention for this file elsewhere in this suite).
const valueStyleValidationRequiredPattern =
  /(?<=[:\-–—]\s{0,3})\b(?:validation required|doğrulama gerekli)\b/gim;
const trailingProseValidationRequiredPattern =
  /\b(?:validation required|doğrulama gerekli)\b(?=\s*[.;:\n]|\s*$)/gim;
const bareValidationRequiredValuePattern = /\b(?:Validation [Rr]equired|Doğrulama [Gg]erekli)\b/g;

function replaceBareValidationRequiredValue(content, language) {
  const valueReplacement = language === "Turkish" ? "Henüz ölçülmedi" : "Not yet measured";
  const proseReplacement = language === "Turkish" ? "doğrulama gerektiriyor" : "requires validation";

  return content
    .replace(valueStyleValidationRequiredPattern, valueReplacement)
    .replace(trailingProseValidationRequiredPattern, proseReplacement)
    .replace(bareValidationRequiredValuePattern, valueReplacement);
}

// --- The exact live bug -----------------------------------------------

test("the exact reported carbon-accounting/ESG Founder Readiness narrative no longer shows the internal tag (the exact live bug)", () => {
  const reported =
    "Validation Confidence: 52/100 - primary customer and pricing Validation Required.";
  const out = replaceBareValidationRequiredValue(reported, "English");

  assert.doesNotMatch(out, /validation required/i);
  assert.equal(out, "Validation Confidence: 52/100 - primary customer and pricing requires validation.");
});

test("the lowercase variant of the same trailing shape is also caught", () => {
  const out = replaceBareValidationRequiredValue(
    "Execution Complexity: 43/100 - integration and regulatory risk validation required.",
    "English"
  );

  assert.doesNotMatch(out, /validation required/i);
  assert.match(out, /requires validation\.$/);
});

test("a trailing tag with no closing period (end of field text) is still caught", () => {
  const out = replaceBareValidationRequiredValue(
    "Evidence Confidence: 26/100 - benchmark-derived estimates only; direct measurement Validation Required",
    "English"
  );

  assert.doesNotMatch(out, /validation required/i);
  assert.match(out, /requires validation$/);
});

// --- KPI-value/status shape is unaffected (no regression) --------------

test("a bare KPI value/status still resolves to 'Not yet measured', not the new prose phrasing", () => {
  const out = replaceBareValidationRequiredValue(
    "Activation: Validation Required | Target: prove first paid activation | Status: Validation required",
    "English"
  );

  assert.doesNotMatch(out, /validation required/i);
  assert.match(out, /Activation: Not yet measured/);
  assert.match(out, /Status: Not yet measured/);
});

test("'Metric: Validation Required' (a bare KPI-repair value with nothing else on the line) still resolves to 'Not yet measured'", () => {
  assert.equal(
    replaceBareValidationRequiredValue("Metric: Validation Required", "English"),
    "Metric: Not yet measured"
  );
});

// --- Legitimate natural English is never touched (no false positive) ---

test("ordinary lowercase prose that continues past the tag is never touched", () => {
  const untouched = [
    "Further validation required before scaling this channel.",
    "The founder should complete additional customer validation required by enterprise buyers.",
  ];

  for (const sentence of untouched) {
    assert.equal(replaceBareValidationRequiredValue(sentence, "English"), sentence);
  }
});

// --- Turkish localization, both shapes ----------------------------------

test("Turkish: the trailing-prose shape localizes to a natural Turkish completion, not the bare tag phrase", () => {
  const out = replaceBareValidationRequiredValue(
    "Doğrulama Güveni: 52/100 - birincil müşteri ve fiyatlandırma Doğrulama gerekli.",
    "Turkish"
  );

  assert.doesNotMatch(out, /Doğrulama gerekli/);
  assert.match(out, /doğrulama gerektiriyor\.$/);
});

test("Turkish: the KPI-value shape still localizes to 'Henüz ölçülmedi'", () => {
  const out = replaceBareValidationRequiredValue(
    "Aktivasyon: Doğrulama gerekli | Hedef: ilk ücretli aktivasyonu kanıtla",
    "Turkish"
  );

  assert.doesNotMatch(out, /Doğrulama gerekli/);
  assert.match(out, /Aktivasyon: Henüz ölçülmedi/);
});

// --- Every Founder Readiness dimension, generically ---------------------

test("every Founder Readiness dimension's trailing-tag explanation is fixed, not just Validation Confidence", () => {
  const dimensions = [
    "Idea Quality",
    "Market Attractiveness",
    "Business Model Quality",
    "Validation Confidence",
    "Execution Complexity",
    "Evidence Confidence",
    "Founder Evidence",
  ];

  for (const label of dimensions) {
    const line = `${label}: 45/100 - primary customer and pricing Validation Required.`;
    const out = replaceBareValidationRequiredValue(line, "English");

    assert.doesNotMatch(out, /validation required/i, `${label} still shows the internal tag`);
    assert.match(out, /requires validation\.$/, `${label} was not completed as natural English`);
  }
});

// --- Drift check ---------------------------------------------------------

test("plan-executor.ts's replaceBareValidationRequiredValue applies the value/prose/residual three-tier replacement in order (drift check)", () => {
  const fnMatch = /function replaceBareValidationRequiredValue\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "replaceBareValidationRequiredValue not found");
  assert.match(fnMatch[0], /valueStyleValidationRequiredPattern/);
  assert.match(fnMatch[0], /trailingProseValidationRequiredPattern/);
  assert.match(fnMatch[0], /bareValidationRequiredValuePattern/);
  assert.match(fnMatch[0], /requires validation/);
  assert.match(fnMatch[0], /doğrulama gerektiriyor/);
});

test("the value-style pattern requires an immediate colon/dash separator, so it cannot match prose-trailing usage (drift check)", () => {
  const patternMatch = /const valueStyleValidationRequiredPattern =\s*\n?\s*([^;]+);/.exec(planExecutorSource);
  assert.ok(patternMatch, "valueStyleValidationRequiredPattern not found");
  assert.match(patternMatch[1], /\(\?<=/, "the value-style pattern no longer uses a lookbehind for the separator");
});
