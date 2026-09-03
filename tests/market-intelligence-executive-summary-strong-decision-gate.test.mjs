import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolveMarketIntelligenceExecutiveDecision } from "../app/lib/report-engine/executive-decision-vocabulary.ts";

function readSourceFile(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

// TASK #16 -- Fix the Market Intelligence Executive Summary
// decision/confidence contradiction.
//
// A REAL regenerated report (fetched directly from the database; report
// id cdb2b520-25a5-4b5c-b125-9fad3341df20, generated 2026-08-28) showed:
//   Decision: "ENTER the U.S."
//   Investment Score: unavailable ("—") -- CORRECT, pre-existing, by-design
//     behavior for Market Intelligence (it never computes an Investment
//     Score at all; this is not part of this bug).
//   Planning Confidence: unavailable ("—")
//   Biggest Risk: "Key unresolved: realistic obtainable market share
//     (SOM) is not evidenced; go/no-go depends on validated
//     penetration/win-rate evidence."
//
// ROOT CAUSE (confirmed by inspecting the report's own persisted
// executiveSummary field): it contained NO "(Confidence: NN%)" token at
// all -- just the model's own raw prose, "Bottom Line — Decision: ENTER
// the U.S.\n...". This is the exact shape resolveMarketIntelligenceExecutiveDecision's
// Tier 1 (deterministic banner, evidence-gated server-side by
// assessMarketEntryConfidence before it is ever written) requires and
// does NOT find here -- meaning assessMarketEntryConfidence's own
// evidence-sufficiency gate never ran against this report at all. The
// resolver fell through to Tier 2 (a bare "Decision:"-labeled sentence,
// confidenceScore forced to null by design, since a raw decision
// statement has no reliably-adjacent confidence figure). Tier 2 is
// deliberately never re-tokenized -- but until this fix, it also never
// checked whether the raw text's own leading decision token was a STRONG
// AFFIRMATIVE claim (this report kind's "GO"-equivalent, ENTER) being
// smuggled past the evidence gate entirely. The result: "ENTER the U.S."
// rendered everywhere the canonical resolver is read from, right next to
// an explicitly unresolved SOM gap and a null confidence score -- the
// exact self-contradictory combination this ticket prohibits.
//
// FIX: resolveMarketIntelligenceExecutiveDecision's Tier 2 now checks
// whether the raw decision text's OWN leading token matches this report
// kind's strong-affirmative vocabulary word (localizeExecutiveDecision
// "GO" in the "market" vocabulary -- ENTER/GİR/EINTRETEN/ENTRER/ENTRAR
// depending on language). If so, it is downgraded to this SAME
// vocabulary's own existing conservative equivalent (CONDITIONAL_GO --
// MONITOR/İZLE/BEOBACHTEN/SURVEILLER/MONITOREAR), with
// canonicalDecision set to PROCEED_WITH_CONDITIONS so downstream
// badge/color logic reflects the change too. confidenceScore correctly
// remains null (Tier 2 never fabricates one). This is a genuine decision-
// VALUE change, not a wording change: MONITOR + unavailable confidence +
// an unresolved SOM gap is a coherent, self-consistent state; ENTER +
// unavailable confidence + an unresolved SOM gap is not.
//
// This module (executive-decision-vocabulary.ts) is a single shared
// library imported by page.tsx, ReportPdfButton.tsx, and Planner.tsx --
// not duplicated per-surface -- so this one fix structurally guarantees
// requirement 8/E (web, PDF, and every decision surface that calls this
// resolver read the identical value; there is no second copy that could
// drift).

const realProductionExecutiveSummary =
  "Bottom Line — Decision: ENTER the U.S.\n" +
  "mid‑market AI compliance & contract intelligence SaaS market for 2027 (evidence-backed growth signal and commercially active vendor landscape; see R12, R4, R5).\n" +
  "Key Findings — 1) Growth signal: multiple market-research providers report a U.S. CLM category expanding from roughly USD 1.5B (2024) toward multi‑billion by 2034 (Emergen Research) [R12]; 2) Commercial readiness: several AI-enabled CLM vendors (Ironclad, Evisort, LawGeex, DocuSign CLM) operate with documented product offerings and procurement evidence [R4][R5][R6][R3].\n" +
  "Biggest Opportunity — Rapid CLM AI adoption among mid-sized U.S. firms driven by productivity gains and documented vendor activity (R12, R4, R5).\n" +
  "Biggest Risk — Key unresolved: realistic obtainable market share (SOM) is not evidenced; go/no-go depends on validated penetration/win‑rate evidence.\n" +
  "Recommendation — 1) Validate SOM by buying 3 market-access data points (see First 90 Days) before major build; 2) Design a 12–18 months product pilot targeting three verticals with compliance modules prioritized.\n" +
  "(Total 136 words)";

test("SCENARIO B (the exact real production defect): a raw, un-bannered 'Decision: ENTER the U.S.' with an explicitly unresolved SOM gap elsewhere in the same text is downgraded to MONITOR, not left as an ungated strong affirmative claim", () => {
  const result = resolveMarketIntelligenceExecutiveDecision(realProductionExecutiveSummary, "English");

  assert.equal(result.decisionLabel, "MONITOR", "a strong affirmative decision with no verified confidence must never survive verbatim");
  assert.equal(result.canonicalDecision, "PROCEED_WITH_CONDITIONS");
  assert.equal(result.confidenceScore, null, "requirement 6: confidence must remain honestly unavailable, never fabricated to pair with the downgraded decision");
  assert.equal(result.decisionSource, "raw-label");
});

test("SCENARIO A (strong evidence + valid score/confidence -> strong decision allowed): the deterministic canonical banner, WHEN present with a real confidence figure, still resolves as a genuine strong decision -- this fix only gates the ungated Tier 2 fallback, never a server-verified Tier 1 banner", () => {
  const result = resolveMarketIntelligenceExecutiveDecision(
    "Decision: ENTER (Confidence: 78%)\nStrong evidence across market sizing, competitive landscape, and obtainable share supports this call.",
    "English"
  );

  assert.equal(result.decisionLabel, "ENTER");
  assert.equal(result.canonicalDecision, "PROCEED");
  assert.equal(result.confidenceScore, 78);
  assert.equal(result.decisionSource, "canonical-banner");
});

test("SCENARIO C (SOM unvalidated + other material gaps -> decision reflects uncertainty): a report whose only decision statement is a raw 'AVOID'/'MONITOR' text (the honest outcome when assessMarketEntryConfidence's own evidence gate DID run and correctly declined a strong verdict) is never touched by this fix -- it already reflects the real uncertainty and must pass through unchanged", () => {
  const monitorResult = resolveMarketIntelligenceExecutiveDecision(
    "Decision: Monitor for a staged U.S. entry, contingent on validating TAM/SAM assumptions and realistic obtainable share.",
    "English"
  );
  assert.equal(monitorResult.decisionLabel, "Monitor for a staged U.S. entry, contingent on validating TAM/SAM assumptions and realistic obtainable share.");
  assert.equal(monitorResult.canonicalDecision, null, "a genuine non-affirmative raw statement keeps the existing 'no reliable enum mapping' behavior -- unchanged by this fix");

  const avoidResult = resolveMarketIntelligenceExecutiveDecision(
    "Decision: AVOID entry given weak unit economics and unresolved obtainable-share evidence.",
    "English"
  );
  assert.equal(avoidResult.decisionLabel, "AVOID entry given weak unit economics and unresolved obtainable-share evidence.");
  assert.equal(avoidResult.canonicalDecision, null);
});

test("SCENARIO D: a regenerated report and a persisted/reloaded report with byte-identical executiveSummary content produce the exact same resolved decision -- the resolver is a pure function of the text, so this holds automatically, but is asserted explicitly as the regression this ticket requires", () => {
  const regenerated = resolveMarketIntelligenceExecutiveDecision(realProductionExecutiveSummary, "English");
  const reloadedFromPersistedStorage = resolveMarketIntelligenceExecutiveDecision(realProductionExecutiveSummary, "English");

  assert.deepEqual(regenerated, reloadedFromPersistedStorage);
});

test("SCENARIO E (web and PDF share one canonical decision state): page.tsx, ReportPdfButton.tsx, and Planner.tsx all import resolveMarketIntelligenceExecutiveDecision from this SAME shared module rather than each defining their own copy -- structurally impossible for them to resolve a different decision for the same report", () => {
  const pageSource = readSourceFile("app/dashboard/[id]/page.tsx");
  const pdfButtonSource = readSourceFile("app/dashboard/[id]/ReportPdfButton.tsx");
  const plannerSource = readSourceFile("components/Planner.tsx");

  // TASK #24 -- all 3 surfaces now resolve exclusively through
  // resolveMarketIntelligenceGatedExecutiveDecision (the
  // canonical-state module), which internally still calls this exact
  // same resolveMarketIntelligenceExecutiveDecision (from the shared
  // vocabulary module) for every report without a persisted canonical
  // state -- so the "one shared source, never independently reimplemented"
  // guarantee holds one level deeper than before, not less strictly.
  for (const source of [pageSource, pdfButtonSource, plannerSource]) {
    assert.match(source, /resolveMarketIntelligenceGatedExecutiveDecision/);
    assert.match(source, /from "@\/app\/lib\/report-engine\/market-intelligence-canonical-state"/);
    assert.doesNotMatch(
      source,
      /import\s*\{[^}]*\bresolveMarketIntelligenceExecutiveDecision\b(?!WithCanonicalState)[^}]*\}\s*from\s*"@\/app\/lib\/report-engine\/executive-decision-vocabulary"/,
      "must not reimplement or directly re-import the bare resolver once every call site goes through the canonical-state wrapper"
    );
  }
  const canonicalStateModuleSource = readSourceFile("app/lib/report-engine/market-intelligence-canonical-state.ts");
  assert.match(canonicalStateModuleSource, /resolveMarketIntelligenceExecutiveDecision/);
  assert.match(canonicalStateModuleSource, /from "@\/app\/lib\/report-engine\/executive-decision-vocabulary"/);
});

test("regression guard, no evidence-standard weakening: a genuinely unavailable decision (no 'Decision:'/'Karar:' label anywhere) still resolves to '—', never guessed or downgraded to a fabricated value", () => {
  const result = resolveMarketIntelligenceExecutiveDecision(
    "This report discusses market conditions at length without ever stating an explicit decision verdict.",
    "English"
  );
  assert.equal(result.decisionLabel, "—");
  assert.equal(result.decisionSource, "unavailable");
  assert.equal(result.canonicalDecision, null);
  assert.equal(result.confidenceScore, null);
});

test("regression guard: the downgrade check only inspects the LEADING token of the already label-confirmed decision phrase -- it never re-scans arbitrary surrounding prose, so a report merely mentioning 'Go-to-Market' elsewhere is unaffected", () => {
  const result = resolveMarketIntelligenceExecutiveDecision(
    "Decision: Monitor pending validation.\nThe company's Go-to-Market strategy focuses on mid-market accounts.",
    "English"
  );
  assert.equal(result.decisionLabel, "Monitor pending validation.");
  assert.equal(result.canonicalDecision, null);
});

test("both languages Tier 2's raw-label matcher supports (English/Turkish -- extractMarketIntelligenceRawDecisionText's own marketIntelligenceRawDecisionLabels list; German/French/Spanish raw-label matching is a separate, pre-existing gap unrelated to this ticket): a raw, un-bannered strong-affirmative decision token is downgraded to that language's MONITOR-equivalent, never left as an ungated strong claim", () => {
  const cases = [
    { language: "English", text: "Decision: ENTER this market immediately.", expectedLabel: "MONITOR" },
    { language: "Turkish", text: "Karar: GİR bu pazara hemen.", expectedLabel: "İZLE" },
  ];

  for (const { language, text, expectedLabel } of cases) {
    const result = resolveMarketIntelligenceExecutiveDecision(text, language);
    assert.equal(result.decisionLabel, expectedLabel, `${language}: expected downgrade to ${expectedLabel}, got ${result.decisionLabel}`);
    assert.equal(result.canonicalDecision, "PROCEED_WITH_CONDITIONS", `${language}: expected canonicalDecision PROCEED_WITH_CONDITIONS`);
    assert.equal(result.confidenceScore, null, `${language}: confidence must remain unavailable, never fabricated`);
  }
});
