import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  reconcileMarketIntelligenceDecisionText,
  resolveMarketIntelligenceExecutiveDecision,
} from "../app/lib/report-engine/executive-decision-vocabulary.ts";

// TASK #17B -- Eliminate the remaining ENTER leakage inside Executive
// Summary.
//
// Task #17 fixed Strategic Recommendations and confirmed every BADGE/PILL
// decision surface (Decision Signal, Investment Decision Snapshot,
// Executive Snapshot, Strategic Recommendations) reads the canonical
// resolver. Real localhost verification proved the invariant was STILL
// violated: Executive Summary's own "Bottom Line" supporting text and its
// "Executive Highlights" fallback both showed "Bottom Line — Decision:
// ENTER the U.S." verbatim, right next to a correctly-resolved MONITOR
// badge on the SAME card.
//
// ROOT CAUSE: page.tsx's and Planner.tsx's ExecutiveSummaryVisual each
// call extractFirstInsight(content) -- a generic helper that returns the
// content's own first line over 24 characters, completely independent of
// marketDecision (the resolver output already computed a few lines above
// in the SAME function). Two call sites read this raw, un-reconciled
// text directly: the "AI Investment Score" panel's supporting line, and
// the "Executive Highlights" list's fallback when
// getMarketIntelligenceExecutiveHighlights finds no labeled candidates
// (exactly this report's case, since its raw executiveSummary predates
// the canonical banner splice and uses "Bottom Line —"/"Key Findings —"
// labels the labeled extractor doesn't recognize at all).
//
// FIX: a new exported function, reconcileMarketIntelligenceDecisionText,
// in the SAME canonical module every decision badge already reads from.
// It finds a "Decision:"/"Karar:"-labeled clause inside arbitrary free
// text and, ONLY when that clause's own leading token is an unverified
// strong-affirmative claim disagreeing with the already-resolved
// canonical decision passed in, replaces JUST that clause with a
// decision label matching the canonical decision -- preserving every
// word of surrounding context (market/geography/timeframe/citations).
// Per the ticket's explicit instruction this is NOT a bare word swap:
// "Decision: ENTER the U.S." becomes "Current Decision: MONITOR —
// validate the unresolved evidence before entering the U.S.", reframing
// the preserved context as conditional rather than restating it as an
// unconditional action. Both ExecutiveSummaryVisual leak sites, in both
// page.tsx and Planner.tsx, now pipe their extractFirstInsight() output
// (and every getMarketIntelligenceExecutiveHighlights candidate) through
// this reconciliation before display.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);

function extractFunctionSource(source, functionName) {
  const startMatch = source.match(new RegExp(`function ${functionName}\\(`));
  assert.ok(startMatch, `${functionName} not found`);
  const start = startMatch.index;

  let i = start + startMatch[0].length - 1;
  let parenDepth = 1;
  while (parenDepth > 0) {
    i += 1;
    if (source[i] === "(") parenDepth += 1;
    else if (source[i] === ")") parenDepth -= 1;
  }
  while (source[i] !== "{") {
    i += 1;
  }

  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);

  return source.slice(start, i);
}

async function compileExtractFirstInsight(source) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-first-insight-"));
  const outPath = join(dir, "extract.mts");
  writeFileSync(outPath, `${extractFunctionSource(source, "extractFirstInsight")}\nexport { extractFirstInsight };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractFirstInsight;
}

// The EXACT real content shape (report id cdb2b520-25a5-4b5c-b125-9fad3341df20)
// that reproduced this defect live.
const realExecutiveSummary =
  "Bottom Line — Decision: ENTER the U.S.\n" +
  "mid‑market AI compliance & contract intelligence SaaS market for 2027 (evidence-backed growth signal and commercially active vendor landscape; see R12, R4, R5).\n" +
  "Key Findings — 1) Growth signal: multiple market-research providers report a U.S. CLM category expanding [R12].\n" +
  "Biggest Risk — Key unresolved: realistic obtainable market share (SOM) is not evidenced; go/no-go depends on validated penetration/win-rate evidence.";

test("SCENARIO (root cause reproduction): canonical decision resolves to MONITOR for the real report content", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision(realExecutiveSummary, "English");
  assert.equal(decision.decisionLabel, "MONITOR");
  assert.equal(decision.canonicalDecision, "PROCEED_WITH_CONDITIONS");
});

test("BOTTOM LINE cannot reintroduce ENTER: extractFirstInsight's raw output for the real content, reconciled against the canonical MONITOR decision, no longer asserts ENTER", async () => {
  for (const source of [pageSource, plannerSource]) {
    const extractFirstInsight = await compileExtractFirstInsight(source);
    const rawInsight = extractFirstInsight(realExecutiveSummary);
    assert.equal(rawInsight, "Bottom Line — Decision: ENTER the U.S.", "sanity check: this is genuinely the raw leaking text");

    const decision = resolveMarketIntelligenceExecutiveDecision(realExecutiveSummary, "English");
    const reconciled = reconcileMarketIntelligenceDecisionText(rawInsight, decision, "English");

    assert.doesNotMatch(reconciled, /\bDecision:\s*ENTER\b/i, "the reconciled Bottom Line text must never assert ENTER");
    assert.match(reconciled, /Current Decision:\s*MONITOR/, "must explicitly state the canonical MONITOR decision");
    assert.match(reconciled, /the U\.S\./, "must preserve the useful geographic/market context");
  }
});

test("EXECUTIVE HIGHLIGHTS cannot reintroduce ENTER: the same fallback text, when it becomes the Executive Highlights list's only entry, is reconciled identically", async () => {
  for (const source of [pageSource, plannerSource]) {
    const extractFirstInsight = await compileExtractFirstInsight(source);
    const rawInsight = extractFirstInsight(realExecutiveSummary);
    const decision = resolveMarketIntelligenceExecutiveDecision(realExecutiveSummary, "English");
    const reconciled = reconcileMarketIntelligenceDecisionText(rawInsight, decision, "English");

    assert.doesNotMatch(reconciled, /\bENTER\b/, "Executive Highlights' fallback entry must never contain a bare ENTER claim");
  }
});

test("WEB SOURCE CHECK: both ExecutiveSummaryVisual leak sites in page.tsx and Planner.tsx now route extractFirstInsight through reconcileExecutiveText before display", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /const reconcileExecutiveText = \(text: string\) =>\s*\n\s*marketDecision \? reconcileMarketIntelligenceDecisionText\(text, marketDecision, evidenceLocale\) : text;/
    );
    assert.match(
      source,
      /\{reconcileExecutiveText\(extractFirstInsight\((?:content|section\.content)\)\) \|\| "Executive signal is being assembled\."\}/,
      "the AI Investment Score supporting line must be reconciled"
    );
    assert.match(
      source,
      /highlights\.length > 0 \? highlights\.map\(reconcileExecutiveText\) : \[reconcileExecutiveText\(extractFirstInsight\((?:content|section\.content)\)\)\]/,
      "the Executive Highlights fallback (and every real highlight candidate) must be reconciled"
    );
  }
});

test("STRATEGIC RECOMMENDATIONS remains MONITOR: unaffected by this fix, still resolves through the same canonical resolver established in Task #17", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision(realExecutiveSummary, "English");
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const strategicRecommendationDecision = isMarketIntelligence/);
  }
  assert.match(pdfButtonSource, /const strategicRecommendationDecision = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/);
  assert.equal(decision.decisionLabel, "MONITOR");
});

test("PDF PRESENTATION remains aligned: ReportPdfButton.tsx and Planner.tsx's PDF drawer have no equivalent 'raw first line of content' extraction for the executive/decision card -- confirmed there is no PDF-side reproduction of this exact leak class", () => {
  // The PDF Executive Decision card (getExecutiveDecisionCardLayout) reads
  // only explicitly LABELED sub-sections (Why/Top Risk/Missing Evidence/
  // Next Action) via extractMetricValueFromAliases, never a raw
  // first-line-of-content fallback the way extractFirstInsight does --
  // structurally incapable of reproducing this specific leak shape.
  assert.doesNotMatch(pdfButtonSource, /function extractFirstInsight/);
  // TASK #23 -- this call site now prefers a persisted canonical-state
  // snapshot over re-parsing content, via
  // resolveMarketIntelligenceExecutiveDecisionWithCanonicalState; it
  // still falls back to the exact same resolveMarketIntelligenceExecutiveDecision
  // for every report without one, so this leak class remains structurally
  // impossible either way.
  assert.match(
    pdfButtonSource,
    /const marketDecision = isMarketIntelligenceReport\s*\n\s*\? resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n\s*readMarketIntelligenceCanonicalState\(report\.metadata\),\s*\n\s*content,\s*\n\s*pdfLocale === "tr" \? "Turkish" : "English"\s*\n\s*\)/
  );

  // Planner.tsx DOES define extractFirstInsight, but only for its web JSX
  // rendering (both call sites already fixed above); its separate PDF-
  // drawing code (well past the web JSX section of this file) never calls
  // it at all.
  const pdfDrawingSectionStart = plannerSource.indexOf("const drawPdfVisual = (section: ReportSection, sectionY: number) => {");
  assert.ok(pdfDrawingSectionStart > 0, "expected to find Planner.tsx's PDF drawing function");
  const pdfDrawingSection = plannerSource.slice(pdfDrawingSectionStart, pdfDrawingSectionStart + 20000);
  assert.doesNotMatch(pdfDrawingSection, /extractFirstInsight/);
});

test("CANONICAL ENTER still displays ENTER when legitimately supported: a genuine Tier 1 banner with real confidence is never rewritten by the reconciliation helper", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision(
    "Decision: ENTER (Confidence: 82%)\nStrong evidence across all decision-critical pillars supports this call.",
    "English"
  );
  assert.equal(decision.decisionLabel, "ENTER");

  const rawText = "Bottom Line — Decision: ENTER the U.S. market with strong conviction.";
  const reconciled = reconcileMarketIntelligenceDecisionText(rawText, decision, "English");
  assert.equal(reconciled, rawText, "a genuinely verified ENTER must never be altered");
});

test("NEGATIVE/NO-GO decisions remain consistent: canonical AVOID reconciles a contradictory raw ENTER sentence to AVOID, not to MONITOR or any other value", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision(
    "Decision: AVOID (Confidence: 74%)\nUnit economics do not support entry at this time.",
    "English"
  );
  assert.equal(decision.decisionLabel, "AVOID");

  const reconciled = reconcileMarketIntelligenceDecisionText(
    "Bottom Line — Decision: ENTER the U.S. immediately.",
    decision,
    "English"
  );
  assert.match(reconciled, /Current Decision:\s*AVOID/);
  assert.doesNotMatch(reconciled, /\bENTER\b/);
});

test("regression guard, no evidence-standard weakening: ordinary prose with no decision-labeled clause (including a 'Go-to-Market' mention) is never altered", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision("This market shows strong growth potential.", "English");
  const text = "This market shows strong growth potential with a Go-to-Market motion planned for Q3.";
  assert.equal(reconcileMarketIntelligenceDecisionText(text, decision, "English"), text);
});

test("regression guard: raw text that already agrees with the canonical decision (both MONITOR) is returned completely unchanged, never re-worded unnecessarily", () => {
  const text = "Bottom Line — Decision: MONITOR before scaling further.";
  const decision = resolveMarketIntelligenceExecutiveDecision(text, "English");
  assert.equal(decision.decisionLabel, "MONITOR before scaling further.");
  assert.equal(reconcileMarketIntelligenceDecisionText(text, decision, "English"), text);
});

test("Turkish: a raw strong-affirmative decision (GİR) reconciles to the canonical MONITOR-equivalent (İZLE), preserving trailing context", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision(
    "Sonuç — Karar: GİR ABD pazarına hemen.",
    "Turkish"
  );
  assert.equal(decision.decisionLabel, "İZLE");

  const reconciled = reconcileMarketIntelligenceDecisionText("Sonuç — Karar: GİR ABD pazarına hemen.", decision, "Turkish");
  assert.doesNotMatch(reconciled, /\bGİR\b/);
  assert.match(reconciled, /Güncel Karar:\s*İZLE/);
});
