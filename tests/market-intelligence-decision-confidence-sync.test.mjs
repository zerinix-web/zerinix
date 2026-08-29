import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL FIX -- root-cause repair (ticket: "Fix the canonical decision
// consistency bug across the ZERINIX Market Intelligence report").
//
// CONFIRMED ROOT CAUSE: the PREVIOUS fix's PDF cover/card fallback
// (`buildExecutiveSnapshot(fullReportContent, undefined, ...)`, reached
// whenever the deterministic "Decision: TOKEN (Confidence: NN%)" banner
// wasn't present) scans the ENTIRE report for a bare decision keyword and
// a bare confidence percentage:
//   - extractDecision's fallback (`\b(GO|WAIT|NO-GO|...|PASS|...)\b`)
//     matches the "GO" inside "Go-to-Market" -- a phrase virtually every
//     Market Intelligence report mentions somewhere in its full text,
//     since a hyphen is a non-word boundary for `\b`. It additionally
//     maps a matched "PASS" token to "GO" -- backwards.
//   - extractConfidenceValue's fallback can attach an unrelated "NN%"
//     mentioned anywhere near the word "confidence" in ordinary prose.
// The web dashboard (correctly scoped to just the executiveSummary
// section) showed the report's real, conservative "MONITOR FOR A STAGED
// U.S. ..." text with no confidence figure, while the PDF (scanning the
// WHOLE report) hit the "Go-to-Market" trap and fabricated "GO"/"30%".
//
// FIX: every decision-bearing surface (web Executive Summary, web
// Executive Snapshot, PDF cover, PDF Executive Summary) now resolves
// through ONE new canonical function,
// resolveMarketIntelligenceExecutiveDecision
// (app/lib/report-engine/executive-decision-vocabulary.ts), which never
// falls through to either unsafe scan: it reads the deterministic banner
// if present (confidence read only from that SAME matched line), else
// the raw "Decision:"/"Recommendation:" labeled text verbatim (never
// re-scanned for a keyword, never remapped), else an honest "—" with no
// numeric confidence at all.
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importExecutiveDecisionVocabulary() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-mi-decision-sync-"));
  const outPath = join(dir, "executive-decision-vocabulary.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { resolveMarketIntelligenceExecutiveDecision } = await importExecutiveDecisionVocabulary();

const pdfButtonSource = readFileSync("app/dashboard/[id]/ReportPdfButton.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");

function loadFunction(source, name) {
  const match = source.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, `${name} not found`);
  const [signatureLine, ...rest] = match[0].split("\n");
  const jsSignature = signatureLine
    .replace(/:\s*[^,)]+(?=[,)])/g, "")
    .replace(/\)\s*:\s*[^{]+\{/, ") {");
  const source2 = [jsSignature, ...rest].join("\n");
  const fn = new Function(`${source2}\nreturn ${name};`)();
  return fn;
}

// --- Behavioral proof: reproduces the EXACT reported failure shape -----

const STAGED_PILOT_EXECUTIVE_SUMMARY = `Bottom Line: A cautious, staged entry is warranted while key sizing evidence remains unverified.

Decision: Monitor for a staged U.S. entry, contingent on validating TAM/SAM assumptions and observing early pilot signal before any broader commitment.

Key Findings:
- Sizing evidence for TAM/SAM/SOM is not yet independently verifiable.
- CAGR could not be confirmed from an authoritative source.

Biggest Risk: Insufficient sizing evidence could lead to overinvestment in an unproven segment.`;

// A realistic full-report blob: the SAME executive summary above, plus
// OTHER sections that (like virtually every real Market Intelligence
// report) mention "Go-to-Market" while discussing entry strategy -- the
// exact phrase that triggered the confirmed bug when a fallback scanned
// the whole report instead of just the executive summary.
const FULL_REPORT_WITH_GO_TO_MARKET_ELSEWHERE = `Executive Summary
${STAGED_PILOT_EXECUTIVE_SUMMARY}

Go-to-Market Strategy
A phased Go-to-Market plan should prioritize design partners before any broader rollout. The recommended Go-to-Market motion is a narrow, invite-only pilot.

Strategic Recommendations
The evidence supports a constrained pilot, not an immediate broad launch. We would pass on a full-scale rollout until sizing evidence is independently verified.`;

test("REGRESSION (exact reported failure shape): resolveMarketIntelligenceExecutiveDecision, given ONLY the executive summary section (correctly scoped, matching web), returns the raw 'Monitor for a staged U.S. ...' text verbatim -- never 'GO'", () => {
  const result = resolveMarketIntelligenceExecutiveDecision(STAGED_PILOT_EXECUTIVE_SUMMARY);
  assert.equal(result.decisionSource, "raw-label");
  assert.match(result.decisionLabel, /Monitor for a staged U\.S\./);
  assert.doesNotMatch(result.decisionLabel.toUpperCase(), /\bGO\b/);
  assert.equal(result.canonicalDecision, null);
  assert.equal(result.confidenceScore, null, "no unsupported numeric confidence may appear");
});

test("REGRESSION (the confirmed root cause, directly reproduced): even when fed the FULL report -- including a 'Go-to-Market' section elsewhere, exactly the shape that broke the old fallback -- resolveMarketIntelligenceExecutiveDecision never returns 'GO' and never fabricates a confidence score, because it is only ever called with the executiveSummary section's own content by every real call site (asserted separately below); this proves the function itself has no full-text keyword scan to exploit in the first place", () => {
  // Even passed the whole report (worse than any real call site), the
  // function only ever inspects the deterministic banner shape or a
  // line-anchored "Decision:" label -- it has no unlabeled full-text
  // keyword scan at all, so the extra "Go-to-Market" text elsewhere
  // cannot influence the result.
  const result = resolveMarketIntelligenceExecutiveDecision(FULL_REPORT_WITH_GO_TO_MARKET_ELSEWHERE);
  assert.doesNotMatch(result.decisionLabel.toUpperCase(), /\bGO\b/);
  assert.notEqual(result.decisionLabel, "GO");
  assert.equal(result.confidenceScore, null);
});

test("REGRESSION: a bare 'PASS' mentioned in the executive summary's own prose (e.g. hedging language) is never remapped to 'GO' -- resolveMarketIntelligenceExecutiveDecision has no keyword-to-token conversion of any kind", () => {
  const content = `Decision: Recommend a staged pilot only.

We would pass on committing to a full national rollout until further evidence is available.`;
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.doesNotMatch(result.decisionLabel.toUpperCase(), /\bGO\b/);
  assert.match(result.decisionLabel, /staged pilot/i);
});

test("REGRESSION: unavailable confidence never fabricates a number (e.g. 30%) merely because the executive summary's own prose mentions an unrelated percentage near the word 'confidence'", () => {
  const content = `Decision: Monitor for a staged entry.

Confidence remains an open question -- roughly 30% of comparable entries in this category eventually scale, but that base rate is not a stated confidence level for THIS report.`;
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.equal(result.confidenceScore, null, "must not fabricate 30% from unrelated base-rate prose");
});

test("Unavailable state: no decision label or confidence label at all resolves to '—' / null, never a guess", () => {
  const result = resolveMarketIntelligenceExecutiveDecision(
    "This section discusses market dynamics without stating a formal decision or confidence figure."
  );
  assert.equal(result.decisionLabel, "—");
  assert.equal(result.decisionSource, "unavailable");
  assert.equal(result.canonicalDecision, null);
  assert.equal(result.confidenceScore, null);
});

// --- Requirement 9: a genuinely evidence-supported GO must still work --

// CRITICAL FIX -- confirmed live (production report on a real market):
// Market Intelligence's decision vocabulary is now ENTER/MONITOR/AVOID
// (see executive-decision-brief.ts's "market" ExecutiveDecisionVocabulary),
// never GO/CONDITIONAL GO/NO-GO or the cross-report-kind Proceed/Reject
// label set -- the SAME report was previously showing "Reject" in one
// place and "NO-GO" verbatim in another. Fixtures below use the real
// market-vocabulary banner shape; decisionLabel now asserts ENTER/MONITOR/
// AVOID directly rather than Proceed/Reject, while canonicalDecision (an
// internal styling-only axis, never displayed as text) is unchanged.
test("PROPERTY (ENTER is not globally suppressed): a genuine deterministic 'Decision: ENTER (Confidence: 82%)' banner still resolves to ENTER/PROCEED with its real confidence, even when the SAME report also mentions 'Go-to-Market' and 'pass' elsewhere", () => {
  const content = `Executive Decision
Decision: ENTER (Confidence: 82%)

Confidence Supported By:
- Three independent sources confirm TAM/SAM sizing.
- CAGR is corroborated by two industry reports.

Go-to-Market Strategy
A phased Go-to-Market plan should prioritize design partners. We would pass on a slower rollout given the strength of the evidence.`;
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.equal(result.decisionSource, "canonical-banner");
  assert.equal(result.canonicalDecision, "PROCEED");
  assert.equal(result.decisionLabel, "ENTER");
  assert.equal(result.confidenceScore, 82);
});

test("PROPERTY (ENTER is not globally suppressed, Turkish): a genuine 'Karar: GİR (Güven: 75%)' banner still resolves correctly", () => {
  const content = "Yönetici Kararı\nKarar: GİR (Güven: 75%)";
  const result = resolveMarketIntelligenceExecutiveDecision(content, "Turkish");
  assert.equal(result.canonicalDecision, "PROCEED");
  assert.equal(result.decisionLabel, "GİR");
  assert.equal(result.confidenceScore, 75);
});

test("A MONITOR/AVOID banner still resolves to its own distinct canonical value, decision label, and confidence, unaffected by this fix", () => {
  const conditional = resolveMarketIntelligenceExecutiveDecision(
    "Decision: MONITOR (Confidence: 55%)"
  );
  assert.equal(conditional.canonicalDecision, "PROCEED_WITH_CONDITIONS");
  assert.equal(conditional.decisionLabel, "MONITOR");
  assert.equal(conditional.confidenceScore, 55);

  const rejected = resolveMarketIntelligenceExecutiveDecision("Decision: AVOID (Confidence: 20%)");
  assert.equal(rejected.canonicalDecision, "REJECT");
  assert.equal(rejected.decisionLabel, "AVOID");
  assert.equal(rejected.confidenceScore, 20);
});

test("Confidence is never picked up from a DIFFERENT, unrelated percentage even when it sits right after the banner's decision token but is not itself the confidence figure", () => {
  const content = "Decision: ENTER (Confidence: 60%) -- note: 30% of pilots historically fail in month one.";
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  // Must read the FIRST, structurally-adjacent 60%, never the unrelated 30% later in the sentence.
  assert.equal(result.confidenceScore, 60);
});

test("REGRESSION (exact reported production defect): the report's own raw executiveSummary banner text and its resolved decisionLabel never disagree -- 'NO-GO'/'Reject' must never appear for Market Intelligence again", () => {
  const content = "Executive Decision\nDecision: AVOID (Confidence: 39%)";
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.equal(result.decisionLabel, "AVOID");
  assert.notEqual(result.decisionLabel, "Reject");
  assert.notEqual(result.decisionLabel, "NO-GO");
  assert.doesNotMatch(content, /\bNO-GO\b/);
});

// --- marketDecisionColorCategory: never defaults to the affirmative GO -

const marketDecisionColorCategory = loadFunction(pdfButtonSource, "marketDecisionColorCategory");

test("REGRESSION: marketDecisionColorCategory no longer defaults unrecognized/unavailable decision text to the affirmative 'GO' color -- only an explicit NO-GO/HAYIR match returns NO_GO; everything else (including '—' and raw legacy text like 'Monitor for a staged U.S. ...') is the neutral CONDITIONAL color", () => {
  assert.equal(marketDecisionColorCategory("—"), "CONDITIONAL");
  assert.equal(marketDecisionColorCategory("Monitor for a staged U.S. entry"), "CONDITIONAL");
  assert.equal(marketDecisionColorCategory("NO-GO"), "NO_GO");
  assert.equal(marketDecisionColorCategory("HAYIR"), "NO_GO");
  // marketDecisionColorCategory can no longer return "GO" at all -- a
  // real GO is colored directly from the canonicalDecision enum before
  // this function is ever reached (see the drift check below).
  const allPossibleOutputs = new Set(
    ["—", "Monitor for a staged pilot", "random unrelated text", "NO-GO", "HAYIR", "go-to-market discussion"].map(
      (text) => marketDecisionColorCategory(text)
    )
  );
  assert.ok(!allPossibleOutputs.has("GO"), "marketDecisionColorCategory must never return GO");
});

// --- Structural drift guards: the exact bug can never silently return --

test("DRIFT GUARD: ReportPdfButton.tsx and Planner.tsx no longer contain the buggy `buildExecutiveSnapshot(fullReportContent, undefined, ...)` Market Intelligence fallback anywhere -- this exact pattern was the confirmed root cause and must never reappear", () => {
  for (const source of [pdfButtonSource, plannerSource]) {
    assert.doesNotMatch(
      source,
      /buildExecutiveSnapshot\(fullReportContent, undefined,/,
      "the exact root-cause fallback pattern must not reappear"
    );
  }
});

test("DRIFT GUARD: Market Intelligence's cover-page confidence and Executive Summary card confidence are read directly from resolveMarketIntelligenceExecutiveDecision's own result -- never a separate extractConfidence(fullReportContent) fallback call (the bare-percentage-anywhere-in-the-whole-report scan that produced the fabricated '30%')", () => {
  assert.match(
    pdfButtonSource,
    /const marketConfidenceScore = marketDecision \? marketDecision\.confidenceScore : null;/
  );
  assert.match(
    pdfButtonSource,
    /const confidence = marketDecision\s*\n\s*\? marketDecision\.confidenceScore\s*\n\s*: extractConfidence\(content\) \?\?/
  );
  assert.match(
    plannerSource,
    /const marketConfidenceScore = marketDecision \? marketDecision\.confidenceScore : null;/
  );
  assert.match(
    plannerSource,
    /const confidence = marketDecision\s*\n\s*\? marketDecision\.confidenceScore\s*\n\s*: extractConfidence\(content\) \?\?/
  );
});

test("PROPERTY A/B (web decision/confidence === PDF decision/confidence): every Market-Intelligence-gated decision surface -- page.tsx's ExecutiveSummaryVisual and ExecutiveSnapshotPanel, Planner.tsx's equivalents, and both PDF exports' cover + Executive Summary card -- calls resolveMarketIntelligenceExecutiveDecision, the ONE canonical source, over the executiveSummary section's own content only", () => {
  // TASK #23 -- 6 of these 9 call sites now resolve through
  // resolveMarketIntelligenceExecutiveDecisionWithCanonicalState (prefers
  // a persisted canonical-state snapshot, falls back to the exact same
  // resolveMarketIntelligenceExecutiveDecision this test still exercises
  // directly for every report without one -- see
  // market-intelligence-canonical-state-persistence.test.mjs's own H1-H4
  // for direct coverage of the wrapper itself). The remaining 3 sites
  // (page.tsx's `section.content,`/`content, evidenceLocale` -- its own
  // Porter's-Five-Forces-adjacent evidence check, unrelated to the top-
  // level decision signal -- and Planner.tsx's `section.content,
  // evidenceLocale` equivalent) are unchanged secondary/consistency-check
  // usages, deliberately left on the direct resolver for this task -- see
  // Task #23's final report for the documented remaining scope.
  const callSites = [
    [pageSource, /resolveMarketIntelligenceExecutiveDecision\(\s*\n\s*section\.content,/],
    [pageSource, /resolveMarketIntelligenceExecutiveDecision\(content, evidenceLocale\)/],
    [
      pageSource,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*executiveSummary \|\| executiveRecommendation,/,
    ],
    [
      plannerSource,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*section\.content,/,
    ],
    [plannerSource, /resolveMarketIntelligenceExecutiveDecision\(section\.content, evidenceLocale\)/],
    [
      pdfButtonSource,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n\s*readMarketIntelligenceCanonicalState\(report\.metadata\),\s*\n\s*marketExecutiveSummaryContent,/,
    ],
    [
      pdfButtonSource,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n\s*readMarketIntelligenceCanonicalState\(report\.metadata\),\s*\n\s*content,/,
    ],
    [
      plannerSource,
      /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(\s*\n\s*marketIntelligenceCanonicalState,\s*\n\s*marketExecutiveSummaryContent,/,
    ],
    [plannerSource, /resolveMarketIntelligenceExecutiveDecision\(content, pdfLocale === "tr" \? "Turkish" : "English"\)/],
  ];

  for (const [source, pattern] of callSites) {
    assert.match(source, pattern);
  }
});

test("PROPERTY (Investment Score/AI Investment Score is never fabricated for Market Intelligence): both web ExecutiveSummaryVisual components force the score to null for Market Intelligence, never falling through to extractConfidence's bare percentage scan", () => {
  assert.match(
    pageSource,
    /const score = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: investmentScore\?\.totalScore \?\?/
  );
  assert.match(
    plannerSource,
    /const score = isMarketIntelligence\s*\n\s*\? null\s*\n\s*: investmentScore\?\.totalScore \?\?/
  );
});

// --- Ticket 3: a recommendation/action must never overwrite decision ---

test("REGRESSION (exact reported failure shape, ticket 3): resolveMarketIntelligenceExecutiveDecision never returns a 'Recommendation:'-labeled next-action sentence as the decision -- reproduces the exact reported defect (a 'Commission a $50k primary demand study...' next-action sentence appearing as the Executive Decision) when the report has no deterministic banner and no clean 'Decision:' line, only a labeled 'Recommendation:' next-step sentence", () => {
  const content =
    "Bottom Line: Monitoring U.S. entry conditions before committing further resources is the prudent path forward given current evidence gaps.\n\nRecommendation: Commission a $50k primary demand study to validate buyer willingness-to-pay before any broader commitment.";

  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.notEqual(result.decisionSource, "raw-label", "must not promote the Recommendation line to a decision");
  assert.doesNotMatch(result.decisionLabel, /Commission a \$50k/);
  assert.equal(result.decisionLabel, "—");
});

test("REGRESSION: a genuinely decision-labeled 'Decision:'/'Karar:' line is still used verbatim when it does not read as an imperative action -- the fix narrows WHICH labels are trusted and adds an action-shape guard, it does not disable the raw-label tier entirely", () => {
  const content = "Decision: A cautious, staged monitoring posture is recommended before committing to full U.S. market entry.";
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.equal(result.decisionSource, "raw-label");
  assert.match(result.decisionLabel, /cautious, staged monitoring posture/);
});

test("REGRESSION: even a 'Decision:'-labeled line is rejected if it reads as an imperative next-step/action sentence rather than a verdict (defense in depth -- the label alone is not trusted if the content itself looks like an action)", () => {
  const content = "Decision: Commission a $50k primary demand study before proceeding.";
  const result = resolveMarketIntelligenceExecutiveDecision(content);
  assert.equal(result.decisionLabel, "—");
  assert.equal(result.decisionSource, "unavailable");
});

test("DRIFT GUARD: the Market Intelligence raw-decision-label fallback no longer treats 'Recommendation'/'Executive recommendation'/'Tavsiye'/'Yönetici tavsiyesi' as decision-label synonyms -- only the unambiguous 'Decision'/'Karar'/'Final decision'/'Nihai karar' labels are matched", async () => {
  const vocabSource = readFileSync(join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts"), "utf8");
  const listMatch = vocabSource.match(/const marketIntelligenceRawDecisionLabels = \[([\s\S]*?)\];/);
  assert.ok(listMatch, "marketIntelligenceRawDecisionLabels not found");
  assert.doesNotMatch(listMatch[1], /"Recommendation"/);
  assert.doesNotMatch(listMatch[1], /"Executive recommendation"/);
  assert.doesNotMatch(listMatch[1], /"Tavsiye"/);
  assert.doesNotMatch(listMatch[1], /"Yönetici tavsiyesi"/);
  assert.match(listMatch[1], /"Decision"/);
  assert.match(listMatch[1], /"Karar"/);
});

test("PROPERTY (semantic separation, ticket 3): resolveMarketIntelligenceExecutiveDecision's decision field and a separately-extracted 'Immediate Next Action' field remain independent -- the SAME content's decision and next action never collapse into the same value", async () => {
  const content =
    "Decision: MONITOR (Confidence: 38%)\n\nImmediate Next Action: Commission a $50k primary demand study to validate buyer willingness-to-pay.";

  const decisionResult = resolveMarketIntelligenceExecutiveDecision(content);
  assert.equal(decisionResult.decisionSource, "canonical-banner");
  assert.doesNotMatch(decisionResult.decisionLabel, /Commission/);

  // The Immediate Next Action extraction (shared across page.tsx/Planner.tsx/PDF)
  // uses a completely distinct label lookup and must independently
  // recover the action text -- proving decision and nextAction are read
  // from distinct, non-overlapping fields, never conflated.
  const briefSource = readFileSync(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts"), "utf8");
  assert.match(briefSource, /immediateNextAction: "Immediate Next Action"/);
});
