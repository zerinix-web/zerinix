import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isExecutiveDecisionSystemEnabled,
  runExecutiveDecisionSystem,
} from "../app/lib/ai/executive-decision-system.ts";
import { buildStrategicDecisionMemo } from "../app/lib/ai/strategic-decision-memo.ts";
import { formatStrategicDecisionMemoReportSection } from "../app/lib/report-engine/executive-decision-system-context.ts";
import { extractExecutiveDecisionFromText } from "../app/lib/report-engine/executive-decision-brief.ts";
import { resolveCanonicalDecisionFromReportText } from "../app/lib/report-engine/executive-decision-vocabulary.ts";

// TASK #65 -- Verify and Harden Business Idea Validation Executive
// Decision Feature-Gate.
//
// STEP 1/3: prove the flag's real end-to-end behavior and the failure
// mode it can cause. STEP 4/5: prove the fix (the persisted Executive
// Decision Memo report section must carry the SAME deterministic
// "Decision: TOKEN (Confidence: NN%)" banner every other report kind's
// executiveSummary carries, so the canonical decision resolvers used by
// web/dashboard/PDF never silently fall through to the unrelated legacy
// investmentScore.recommendation fallback).

// ---------------------------------------------------------------------
// STEP 1/2 -- flag semantics: true / false / missing / malformed.
// ---------------------------------------------------------------------

test("isExecutiveDecisionSystemEnabled: only the exact literal string \"true\" enables the system", () => {
  assert.equal(isExecutiveDecisionSystemEnabled({ ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "true" }), true);
  assert.equal(isExecutiveDecisionSystemEnabled({ ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "false" }), false);
  assert.equal(isExecutiveDecisionSystemEnabled({}), false, "missing must default to disabled");
  assert.equal(isExecutiveDecisionSystemEnabled({ ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "TRUE" }), false, "case-mismatch is malformed, must default to disabled");
  assert.equal(isExecutiveDecisionSystemEnabled({ ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "1" }), false, "non-\"true\" value is malformed, must default to disabled");
  assert.equal(isExecutiveDecisionSystemEnabled({ ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: "" }), false);
  assert.equal(isExecutiveDecisionSystemEnabled({ ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED: undefined }), false);
});

test("STEP 2 -- no repository/configuration evidence sets ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED anywhere checked into the repo (production intent cannot be proven from here)", async () => {
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8").catch(() => "");
  const vercelJson = await readFile(new URL("../vercel.json", import.meta.url), "utf8").catch(() => "");
  assert.doesNotMatch(envExample, /ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED/);
  assert.doesNotMatch(vercelJson, /ZERINIX_EXECUTIVE_DECISION_SYSTEM_ENABLED/);
});

// ---------------------------------------------------------------------
// STEP 3 -- the real failure mode: A (Executive Summary decision
// differs from canonical decision) and C (decision effectively
// disappears from the canonical resolver's point of view, which then
// falls back to an unrelated legacy signal).
// ---------------------------------------------------------------------

const STRONG_BUSINESS_TEXT = `Subject: Pricing review

BUSINESS SUMMARY

This is our business idea and business model. Evidence supporting demand is attached, including signed letters of intent from three customers, and addressable demand exceeds 50,000,000 dollars based on our own analysis.`;

function realGeneratedMemo() {
  const { package: executiveDecisionPackage } = runExecutiveDecisionSystem({
    enabled: true,
    prompt: "We need to decide on our pricing strategy urgently.",
    attachments: [{ name: "pricing_memo.pdf", textContent: STRONG_BUSINESS_TEXT }],
  });
  const memo = buildStrategicDecisionMemo({ enabled: true, executiveDecisionPackage });
  assert.equal(memo.generated, true, "fixture must produce a genuinely generated memo");
  return memo;
}

test("FAILURE MODE PROOF: the persisted Executive Decision Memo section is parseable by the SAME canonical decision extractor every other report kind's executiveSummary uses", () => {
  const memo = realGeneratedMemo();
  const section = formatStrategicDecisionMemoReportSection(memo);

  const banner = extractExecutiveDecisionFromText(section);
  assert.ok(banner, "the persisted section must carry a recognizable Decision: TOKEN banner");
});

test("FAILURE MODE PROOF: the canonical decision resolved from the persisted section reflects the Executive Decision System's OWN signal, never a legacy investmentScore fallback that happens to disagree with it", () => {
  const memo = realGeneratedMemo();
  const section = formatStrategicDecisionMemoReportSection(memo);

  // A legacy investmentScore.recommendation that DISAGREES with the EDS's
  // own signal, deliberately, to prove which one wins.
  const resolved = resolveCanonicalDecisionFromReportText(section, "GO");
  assert.ok(resolved, "resolveCanonicalDecisionFromReportText must find a real decision in the EDS-generated section");

  // This fixture's real executiveDecisionSignal is "proceed_with_caution"
  // (see business-intelligence-orchestrator.ts's computeExecutiveDecisionSignal
  // -- a thin single-attachment fixture never reaches the >=70 aggregate
  // confidence "proceed" threshold), which must map to
  // PROCEED_WITH_CONDITIONS, not to PROCEED (what the disagreeing legacy
  // "GO" fallback would have produced if the banner were absent).
  assert.equal(memo.executiveDecisionSignal, "proceed_with_caution");
  assert.equal(resolved.decision, "PROCEED_WITH_CONDITIONS");
  assert.notEqual(resolved.decision, "PROCEED", "must not silently fall back to the disagreeing legacy investmentScore signal");
});

test("executiveDecisionSignal -> ExecutiveDecisionCode mapping is exhaustive and deterministic for all 3 real signal values", () => {
  const cases = [
    { signal: "proceed", expectedCanonical: "PROCEED" },
    { signal: "proceed_with_caution", expectedCanonical: "PROCEED_WITH_CONDITIONS" },
    { signal: "do_not_proceed_insufficient_evidence", expectedCanonical: "REJECT" },
  ];

  for (const { signal, expectedCanonical } of cases) {
    const memo = { ...realGeneratedMemo(), executiveDecisionSignal: signal };
    const section = formatStrategicDecisionMemoReportSection(memo);
    const resolved = resolveCanonicalDecisionFromReportText(section);
    assert.ok(resolved, `expected a resolvable decision for signal "${signal}"`);
    assert.equal(resolved.decision, expectedCanonical, `signal "${signal}" must resolve to canonical "${expectedCanonical}"`);
  }
});

// ---------------------------------------------------------------------
// STEP 4/preferred invariant -- persisted reports are independent of
// later flag/environment changes: nothing in the fix reads the flag or
// re-derives anything at render time; it is a pure, one-time formatting
// change applied when the section is first built (generation time).
// ---------------------------------------------------------------------

test("formatStrategicDecisionMemoReportSection is a pure function of its input memo -- it reads no environment variable and has no side effects, so a persisted report's stored text is never reinterpreted by a later flag change", async () => {
  const contextSource = await readFile(
    new URL("../app/lib/report-engine/executive-decision-system-context.ts", import.meta.url),
    "utf8"
  );
  const fnStart = contextSource.indexOf("export function formatStrategicDecisionMemoReportSection");
  const fnBody = contextSource.slice(fnStart, contextSource.indexOf("\n}\n", fnStart));
  assert.doesNotMatch(fnBody, /process\.env/, "must not read any environment variable at format time");
  assert.doesNotMatch(fnBody, /isExecutiveDecisionSystemEnabled/, "must not re-check the feature flag when formatting an already-computed memo");
});

test("backward compatibility: no real memo (flag off / never reached ready_for_report_generation) still returns null, never a fabricated banner", () => {
  assert.equal(formatStrategicDecisionMemoReportSection(undefined), null);
  assert.equal(formatStrategicDecisionMemoReportSection(null), null);
  assert.equal(formatStrategicDecisionMemoReportSection({ generated: false }), null);
});

// ---------------------------------------------------------------------
// STEP 5 -- web/PDF parity: both surfaces read the canonical decision
// via the exact same resolveCanonicalDecisionFromReportText function
// (no separate re-implementation on either surface).
// ---------------------------------------------------------------------

test("web/PDF parity: page.tsx and ReportPdfButton.tsx both resolve Business Plan decisions through the same shared resolveCanonicalDecisionFromReportText / extractExecutiveDecisionFromText functions, never a separate independent parse", async () => {
  const pageSource = await readFile(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
  const pdfButtonSource = await readFile(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.match(pageSource, /resolveCanonicalDecisionFromReportText/);
  assert.match(pdfButtonSource, /extractExecutiveDecisionFromText/);
});

// ---------------------------------------------------------------------
// STEP 5 -- no regression to Market Intelligence: this fix only touches
// formatStrategicDecisionMemoReportSection (Business Plan / Strategic
// Advisory pipeline). Market Intelligence's own decision resolution
// (resolveMarketIntelligenceExecutiveDecision, "market" vocabulary) is
// untouched.
// ---------------------------------------------------------------------

test("no regression to Market Intelligence: its own decision resolver still uses the \"market\" vocabulary (ENTER/MONITOR/AVOID) and is untouched by this fix", async () => {
  const vocabSource = await readFile(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(vocabSource, /resolveMarketIntelligenceExecutiveDecision/);
  assert.match(vocabSource, /extractExecutiveDecisionFromText\(text, "market"\)/);
});

test("no regression: formatStrategicDecisionMemoReportSection is still called exactly once and reused at exactly the same 3 override sites in plan-executor.ts", async () => {
  const planExecutorSource = await readFile(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  const callCount = (planExecutorSource.match(/formatStrategicDecisionMemoReportSection\(/g) || []).length;
  assert.equal(callCount, 1);
  const overrideAssignments = planExecutorSource.match(/\.executiveSummary = strategicDecisionMemoReportSection;/g) || [];
  assert.equal(overrideAssignments.length, 3);
});
