// TASK #69A-37 -- Audit and fix financial threshold / text serialization
// integrity without changing valid decision logic.
//
// LIVE BUG (verbatim from a fresh production BIV PDF):
//   "Validation gates before significant spend: paid pilot conversions,
//    LTV:CAC $10kand legal/compliance clearance."
//   "Scaling is fundraising conditional on LTV:CAC $10kand legal/
//    compliance clearance."
//   "Track and measure LTV:CAC; proof: LTV:CAC $10kor documented
//    channel plan."
//
// ROOT CAUSE (traced end-to-end, confirmed by direct reproduction
// against the REAL, unmodified runConsistencyValidationPass before any
// fix, then again after): this is UPSTREAM SEMANTIC CORRUPTION inside
// the final cross-section consistency-correction pass
// (report-consistency-validation.ts's correctMetricMentions, invoked
// once, from plan-executor.ts, against every BIV planField), not a
// rendering/PDF/web-normalization bug and not the model hallucinating a
// dollar figure. Two independent defects combined:
//
//   1. LABEL COLLISION: `\bCAC\b` matches just as well immediately
//      after "LTV:" (":" is a non-word character, so a word boundary
//      exists there too) as it does standing alone -- so the model's
//      own legitimate, dimensionless "LTV:CAC 3" ratio mention got
//      treated as a bare CAC CURRENCY mention and its ratio number was
//      silently overwritten with CAC's own dollar-denominated canonical
//      value ("$10k").
//   2. SWALLOWED SEPARATOR: VALUE_TOKEN's digit-then-optional-unit-
//      suffix pattern had its `\s*` OUTSIDE the optional suffix group,
//      so it greedily consumed the one real separator space after a
//      bare number even when no unit ended up matching -- and the
//      replacement never restores a space it never captured. Combined
//      with defect 1, "LTV:CAC 3 and ..." became "LTV:CAC $10kand ...".
//
// FIX (app/lib/report-consistency-validation.ts): (a) VALUE_TOKEN's
// trailing `\s*` moved INSIDE the same optional group as the unit
// suffix, so it is only ever consumed together with a real, matching
// unit; (b) correctMetricMentions' mentionPattern gained a lookbehind/
// lookahead (COMPOUND_RATIO_NEIGHBOR) that recognizes when a label
// match is actually part of a compound "X:Y"/"X/Y" ratio between two
// short metric abbreviations (LTV:CAC, EV/ARR, EV/EBITDA, TAM/SAM/SOM,
// ...) and leaves it alone -- never treating either half as a bare
// mention of itself. Neither fix touches VALUE_TOKEN's own historical
// #69A-3 rate-suffix-doubling fix, RATE_SUFFIX_TOKEN, or any other
// correction function in this file.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runConsistencyValidationPass } from "../app/lib/report-consistency-validation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const consistencySource = readFileSync(join(repoRoot, "app/lib/report-consistency-validation.ts"), "utf8");

function runPass(sections, metricTargets, extra = {}) {
  const copy = { ...sections };
  const result = runConsistencyValidationPass({
    sections: copy,
    fields: Object.keys(copy),
    language: "English",
    metricTargets,
    metricProtectedFields: [],
    ...extra,
  });
  return { sections: copy, corrections: result.correctionsApplied };
}

// --- [FAIL-BEFORE PROOF] -------------------------------------------------
//
// Reconstructs, verbatim and INLINE (never from git history or any
// specific commit position -- see the #69A-35 lesson this mirrors),
// the exact PRE-FIX shape of VALUE_TOKEN and mentionPattern, and proves
// THAT shape genuinely reproduces the live-reported corruption before
// asserting the CURRENT, real module no longer does.

function buildPreFixMentionPattern(labelPattern) {
  const preFixValueToken = `(?:[<>~≈]?\\s*)?[$€£₺]?\\s*\\d[\\d.,]*\\s*(?:months?|days?|ay\\b|%|k|K|m|M|b|B)?`;
  const rateSuffixToken = `(?:\\/(?:month|mo|year|yr)\\b)?`;
  return new RegExp(
    `\\b(${labelPattern})\\b(\\s*(?:is|was|of|at|[:=\\-–—])?\\s*(?:only|about|approximately|around|roughly|nearly|almost|just|still|currently)?\\s*)(${preFixValueToken}${rateSuffixToken})`,
    "gi"
  );
}

function applyPreFixCorrection(text, labelPattern, canonicalDisplayValue) {
  const pattern = buildPreFixMentionPattern(labelPattern);
  const canonicalNormalized = canonicalDisplayValue.replace(/\s+/g, "").toLowerCase();
  return text.replace(pattern, (match, label, connector, value) => {
    if (value.replace(/\s+/g, "").toLowerCase() === canonicalNormalized) {
      return match;
    }
    return `${label}${connector}${canonicalDisplayValue}`;
  });
}

test("[FAIL-BEFORE PROOF] the exact pre-fix VALUE_TOKEN/mentionPattern shape (reconstructed inline, not from git) genuinely reproduces the live-reported \"LTV:CAC $10kand\"/\"$10kor\" corruption", () => {
  assert.equal(
    applyPreFixCorrection(
      "Validation gates before significant spend: paid pilot conversions, LTV:CAC 3 and legal/compliance clearance.",
      "CAC",
      "$10k"
    ),
    "Validation gates before significant spend: paid pilot conversions, LTV:CAC $10kand legal/compliance clearance.",
    "expected the pre-fix shape to genuinely reproduce the live 'LTV:CAC $10kand' corruption"
  );
  assert.equal(
    applyPreFixCorrection(
      "Track and measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan.",
      "CAC",
      "$10k"
    ),
    "Track and measure LTV:CAC; proof: LTV:CAC $10kor documented channel plan.",
    "expected the pre-fix shape to genuinely reproduce the live 'LTV:CAC $10kor' corruption"
  );
});

// --- [1] CAC currency cannot be serialized as an LTV:CAC ratio ----------

test("[1] a bare CAC currency canonicalDisplayValue never overwrites an LTV:CAC ratio mention", () => {
  const { sections, corrections } = runPass(
    {
      founderRoadmap: "Validation gates before significant spend: paid pilot conversions, LTV:CAC 3 and legal/compliance clearance.",
    },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  assert.equal(
    sections.founderRoadmap,
    "Validation gates before significant spend: paid pilot conversions, LTV:CAC 3 and legal/compliance clearance.",
    "the LTV:CAC ratio mention must survive completely unchanged"
  );
  assert.equal(corrections.length, 0);
});

// --- [2] LTV:CAC ratio preserves correct unit/meaning -------------------

test("[2] an LTV:CAC ratio mention keeps its own ratio number (\"x\" multiplier) intact -- never coerced into a currency figure", () => {
  const { sections } = runPass(
    { risks: "The business should reach LTV:CAC 3x before scaling paid acquisition." },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  assert.match(sections.risks, /LTV:CAC 3x/);
  assert.doesNotMatch(sections.risks, /\$10k/);
});

// --- [3] ratio operators survive normalization ---------------------------

test("[3] a >=/≥-qualified LTV:CAC ratio mention (with an explicit threshold operator) is left completely untouched", () => {
  const { sections, corrections } = runPass(
    { goToMarketPlan: "Fundraising is conditional on LTV:CAC >= 3x and legal/compliance clearance." },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  assert.equal(sections.goToMarketPlan, "Fundraising is conditional on LTV:CAC >= 3x and legal/compliance clearance.");
  assert.equal(corrections.length, 0);
});

// --- [4] spaces/conjunction boundaries survive normalization -----------

test("[4] a bare-number metric correction (no recognized unit suffix immediately after the number) never swallows the separator before the next word", () => {
  const { sections } = runPass(
    { risks: "Break-even Month 9 and beyond looks achievable." },
    [{ labelPattern: "Break-even Month", canonicalDisplayValue: "12", type: "timeline_mismatch" }]
  );
  assert.equal(sections.risks, "Break-even Month 12 and beyond looks achievable.");
  assert.doesNotMatch(sections.risks, /12and/);
});

test("[4b] the same bare-number fix also protects an \"or\"-conjunction boundary, not only \"and\"", () => {
  const { sections } = runPass(
    { risks: "Track and measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan." },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  assert.equal(sections.risks, "Track and measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan.");
  assert.doesNotMatch(sections.risks, /\$10kor/);
});

// --- [5]/[6] validation/fundraising/scaling gates use canonical --------
// --- threshold semantics (same mechanism proves all gate wording) ------

test("[5/6] every live-reported gate sentence shape (validation gate, fundraising condition, scaling/proof gate) survives the real consistency pass with its LTV:CAC ratio intact", () => {
  const fixtures = {
    founderRoadmap: "Validation gates before significant spend: paid pilot conversions, LTV:CAC 3 and legal/compliance clearance.",
    goToMarketPlan: "Scaling is fundraising conditional on LTV:CAC 3 and legal/compliance clearance.",
    risks: "Track and measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan.",
  };
  const { sections, corrections } = runPass(fixtures, [
    { labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" },
    { labelPattern: "LTV", canonicalDisplayValue: "$26k", type: "financial_metric_mismatch" },
  ]);
  for (const field of Object.keys(fixtures)) {
    assert.equal(sections[field], fixtures[field], `expected ${field} to survive unchanged`);
  }
  assert.equal(corrections.length, 0);
});

// --- [7]/[8] the exact malformed strings can never occur again ----------

test("[7] \"$10kand\" can never occur in output from the real, current consistency pass, for any field/target combination exercised in this file", () => {
  const { sections } = runPass(
    {
      founderRoadmap: "Validation gates before significant spend: paid pilot conversions, LTV:CAC 3 and legal/compliance clearance.",
      goToMarketPlan: "Scaling is fundraising conditional on LTV:CAC 3 and legal/compliance clearance.",
    },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  for (const value of Object.values(sections)) {
    assert.doesNotMatch(value, /\$10kand/);
  }
});

test("[8] \"$10kor\" can never occur in output from the real, current consistency pass", () => {
  const { sections } = runPass(
    { risks: "Track and measure LTV:CAC; proof: LTV:CAC 3 or documented channel plan." },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  for (const value of Object.values(sections)) {
    assert.doesNotMatch(value, /\$10kor/);
  }
});

// --- [9] web/PDF semantic parity -----------------------------------------

test("[9] the consistency-correction pass runs exactly once, in plan-executor.ts, before persistence -- web and PDF necessarily read the SAME already-corrected text, never two independently-corrected copies", () => {
  const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
  const occurrences = (planExecutorSource.match(/runConsistencyValidationPass\(/g) || []).length;
  assert.equal(occurrences, 1, "expected exactly one call site so web/PDF parity is structural, not coincidental");
});

// --- [10] existing financial metrics remain unchanged when their -------
// --- canonical inputs are unchanged --------------------------------------

test("[10] a metric mention that already matches its canonical value is left byte-identical (no spurious correction, no whitespace drift introduced by this fix)", () => {
  const { sections, corrections } = runPass(
    { financialAssumptionsFree: "CAC is currently $10k and trending flat." },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  assert.equal(sections.financialAssumptionsFree, "CAC is currently $10k and trending flat.");
  assert.equal(corrections.length, 0);
});

test("[10b] a genuinely mismatched bare CAC currency mention is still corrected exactly as before this fix (regression guard against over-correcting the label-collision fix into a no-op)", () => {
  const { sections, corrections } = runPass(
    { financialAssumptionsFree: "CAC is currently 8k but should stabilize near $10k." },
    [{ labelPattern: "CAC", canonicalDisplayValue: "$10k", type: "financial_metric_mismatch" }]
  );
  assert.equal(sections.financialAssumptionsFree, "CAC is currently $10k but should stabilize near $10k.");
  assert.equal(corrections.length, 1);
  assert.equal(corrections[0].type, "financial_metric_mismatch");
});

test("[10c] a Runway correction with a real unit suffix (\"6 months\") is completely unaffected by the VALUE_TOKEN space-handling fix", () => {
  const { sections } = runPass(
    { risks: "Runway is only 4 months, which is tight." },
    [{ labelPattern: "Runway", canonicalDisplayValue: "6 months", type: "timeline_mismatch" }]
  );
  assert.equal(sections.risks, "Runway is only 6 months, which is tight.");
});

test("[10d] a bonus, forward-looking case: an acquisition-style EV/ARR ratio mention is equally protected from an ARR currency target (same class of bug, different report vocabulary)", () => {
  const { sections, corrections } = runPass(
    { dealThesis: "The transaction implies a 4.0x EV/ARR multiple, which is reasonable." },
    [{ labelPattern: "ARR", canonicalDisplayValue: "$2.4M", type: "financial_metric_mismatch" }]
  );
  assert.equal(sections.dealThesis, "The transaction implies a 4.0x EV/ARR multiple, which is reasonable.");
  assert.equal(corrections.length, 0);
});

// --- [11]/[12]/[13] regression safety ------------------------------------

test("[11] Competitor Landscape's own module carries no #69A-37 marker -- this is a financial-threshold-text fix only", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"), "utf8");
  assert.doesNotMatch(source, /#69A-37/);
});

test("[12] Porter's Five Forces' own module carries no #69A-37 marker", () => {
  const source = readFileSync(join(repoRoot, "app/lib/report-engine/porters-five-forces-state.ts"), "utf8");
  assert.doesNotMatch(source, /#69A-37/);
});

test("[13] the canonical decision engine (investment-score.ts) and financial model (financial-model.ts) carry no #69A-37 marker -- no score/threshold COMPUTATION changed, only how an already-correct value is matched/substituted into free-form narrative text", () => {
  for (const relativePath of ["app/lib/ai/investment-score.ts", "app/lib/ai/financial-model.ts", "app/lib/ai/financial-assumptions.ts"]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-37/, `${relativePath} should not carry a #69A-37 marker`);
  }
});

test("the fix's own diff surface is confined to report-consistency-validation.ts's VALUE_TOKEN and correctMetricMentions' mentionPattern -- no change to RATE_SUFFIX_TOKEN, correctRecommendationMentions, or any other correction function in this file", () => {
  assert.match(consistencySource, /#69A-37/);
  // RATE_SUFFIX_TOKEN itself is byte-identical to before this fix.
  const rateSuffixTokenLine = consistencySource
    .split("\n")
    .find((line) => line.trimStart().startsWith("const RATE_SUFFIX_TOKEN ="));
  assert.ok(rateSuffixTokenLine, "RATE_SUFFIX_TOKEN declaration not found");
  assert.ok(
    rateSuffixTokenLine.includes("month|mo|year|yr") && rateSuffixTokenLine.includes("/"),
    "RATE_SUFFIX_TOKEN must remain untouched"
  );
  assert.ok(
    consistencySource.includes('const COMPOUND_RATIO_NEIGHBOR = "(?:TAM|SAM|SOM|ARR|MRR|CAC|LTV|ROI|IRR|EV|EBITDA)";'),
    "expected the new COMPOUND_RATIO_NEIGHBOR constant to exist exactly as added"
  );
  assert.ok(
    consistencySource.includes('function correctRecommendationMentions('),
    "correctRecommendationMentions must remain untouched by this fix"
  );
});
