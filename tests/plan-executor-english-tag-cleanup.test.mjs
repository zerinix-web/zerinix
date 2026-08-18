import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces a real production bug: for a Turkish report, enforcePlanReportLanguage
// already converted the model's required Verified/Estimated/Assumption/AI Analysis
// claim-classification tags (the field prompt's evidence-labeling instruction,
// which cannot be changed) into clean Turkish phrasing. For an English report,
// the same bare tags -- "AI Analysis", "Estimated", "Assumption" -- reached the
// PDF completely unconverted, and are themselves banned raw internal-status
// strings for user-facing output. This mirrors the fix's exact regex, verbatim
// from the source, matching this codebase's established convention for
// plan-executor.ts (heavy Supabase/auth dependencies prevent clean direct import).

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

const aiAnalysisTagPattern = /\bAI Analysis\b(?=\s*[:).|\n]|$)/gim;
const estimatedTagPattern = /(^|[:|(\-–—]\s*)Estimated\b(?=\s*[:).|\-–—\n]|$)/gim;
const assumptionTagPattern = /(^|[:|(\-–—]\s*)Assumption\b(?=\s*[:).|\-–—\n]|$)/gim;
const compoundTagPattern =
  /\b(Verified|Estimated|Assumption|AI Analysis)\s*\/\s*(Verified|Estimated|Assumption|AI Analysis)\b/gi;
const parenTagPattern = /\b(Estimated|Assumption)\b(?=\s*\))/gi;

function convertTagWord(word) {
  const normalized = word.toLowerCase();
  if (normalized === "verified") return "Verified";
  if (normalized === "estimated") return "Approximate";
  if (normalized === "assumption") return "Planning assumption";
  return "model-derived estimate";
}

function cleanEnglishInternalTags(text) {
  return text
    .replace(compoundTagPattern, (_m, first, second) => `${convertTagWord(first)}/${convertTagWord(second)}`)
    .replace(parenTagPattern, (_m, word) => (word.toLowerCase() === "estimated" ? "Approximate" : "Planning assumption"))
    .replace(aiAnalysisTagPattern, "model-derived estimate")
    .replace(estimatedTagPattern, "$1Approximate")
    .replace(assumptionTagPattern, "$1Planning assumption");
}

test("mirrored English tag-cleanup patterns are present verbatim in the source (catches drift)", () => {
  assert.ok(
    planExecutorSource.includes(aiAnalysisTagPattern.source),
    "AI Analysis tag pattern has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(estimatedTagPattern.source),
    "Estimated tag pattern has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(assumptionTagPattern.source),
    "Assumption tag pattern has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(compoundTagPattern.source),
    "compound tag/tag pattern has diverged from plan-executor.ts"
  );
  assert.ok(
    planExecutorSource.includes(parenTagPattern.source),
    "paren-close tag pattern has diverged from plan-executor.ts"
  );
});

test("bare internal classification tags never reach the user in an English report", () => {
  const content = [
    "Confidence: AI Analysis",
    "CAC: Estimated",
    "Revenue: Assumption",
  ].join("\n");
  const cleaned = cleanEnglishInternalTags(content);

  assert.doesNotMatch(cleaned, /\bAI Analysis\b/);
  assert.doesNotMatch(cleaned, /:\s*Estimated\b/);
  assert.doesNotMatch(cleaned, /:\s*Assumption\b/);
  assert.match(cleaned, /Confidence: model-derived estimate/);
  assert.match(cleaned, /CAC: Approximate/);
  assert.match(cleaned, /Revenue: Planning assumption/);
});

test("bare tags followed by a pipe (kpiDashboard's 'Label: VALUE | Target: ... | Status: ...' row shape) are still converted", () => {
  // Reproduces a real production bug found via live report generation:
  // kpiDashboard rows are pipe-delimited ("Activation: AI Analysis |
  // Target: ... | Status: ..."), so the tag is followed by " | ", not by
  // any of the original lookahead's terminators (:).\n) -- the bare "AI
  // Analysis" tag reached the PDF completely unconverted.
  const content = [
    "Activation: AI Analysis | Target: prove first paid activation | Status: model-derived estimate",
    "CAC: Estimated | Target: validate channel cost",
    "Revenue: Assumption | Target: validate pricing",
  ].join("\n");
  const cleaned = cleanEnglishInternalTags(content);

  assert.doesNotMatch(cleaned, /\bAI Analysis\b/);
  assert.doesNotMatch(cleaned, /:\s*Estimated\s*\|/);
  assert.doesNotMatch(cleaned, /:\s*Assumption\s*\|/);
  assert.match(cleaned, /Activation: model-derived estimate \| Target:/);
  assert.match(cleaned, /CAC: Approximate \| Target:/);
  assert.match(cleaned, /Revenue: Planning assumption \| Target:/);
});

test("a tag word sitting right before a closing paren, with ordinary prose words in front of it, is still converted", () => {
  // Captured verbatim from a live gpt-5-mini report generation:
  // "(financial model Estimated)" and "(model ARPA $850/mo Estimated)"
  // -- the tag is the last word inside a trailing parenthetical, preceded
  // by ordinary prose rather than a delimiter, so the original
  // delimiter-scoped pattern (which required the tag to come right AFTER
  // a delimiter) never matched it.
  const content = [
    "Willingness to pay: willing to test low monthly fees rising to ARPA $850/mo if ROI clear (financial model Estimated).",
    "Pricing unit: monthly per-account ARPA (model ARPA $850/mo Estimated) or per-unit pricing.",
  ].join("\n");
  const cleaned = cleanEnglishInternalTags(content);

  assert.doesNotMatch(cleaned, /\bEstimated\)/);
  assert.match(cleaned, /\(financial model Approximate\)/);
  assert.match(cleaned, /\(model ARPA \$850\/mo Approximate\)/);
});

test("two tag words joined by a slash (a compound evidence classifier) are both converted, even mid-sentence with no trailing delimiter", () => {
  // Captured verbatim from a live gpt-5-mini report generation:
  // "many financials are Estimated/AI Analysis requiring primary
  // validation." -- both tag words are used as a compound noun phrase
  // with no delimiter on either side, which the individual delimiter-
  // scoped patterns can never safely match without corrupting ordinary
  // prose. The slash-joined shape itself never occurs organically, so it
  // is a safe, unambiguous signal on its own.
  const content =
    "Evidence Confidence: 41/100 - many financials are Estimated/AI Analysis requiring primary validation.";
  const cleaned = cleanEnglishInternalTags(content);

  assert.doesNotMatch(cleaned, /\bEstimated\/AI Analysis\b/);
  assert.match(cleaned, /Approximate\/model-derived estimate requiring primary validation/);
});

test("ordinary sentence use of the same words is never touched", () => {
  const content = [
    "Estimated market size is $50M and growing at a healthy rate.",
    "Based on this assumption, the company can reach profitability within two years.",
    "This uses AI Analysis techniques broadly across the product line.",
  ].join("\n");
  const cleaned = cleanEnglishInternalTags(content);

  assert.equal(cleaned, content);
});
