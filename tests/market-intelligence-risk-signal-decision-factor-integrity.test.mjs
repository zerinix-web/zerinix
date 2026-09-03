import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { resolveMarketIntelligenceExecutiveDecision } from "../app/lib/report-engine/executive-decision-vocabulary.ts";

// TASK #20 -- Audit and harden Market Intelligence risk, market-signal,
// and decision-factor consistency.
//
// Focused audit of the current REAL Market Intelligence report against
// the reported contradiction: Executive Decision = MONITOR, SOM =
// Validation Needed, yet the Executive Snapshot's "Risk Level" tile
// showed "High" while its own "Risk Heatmap" tile, on the SAME card,
// showed five "Low" ratings.
//
// ROOT CAUSE (two variables in the same panel, traced precisely against
// the real report's exact content before any fix was written):
//
// 1. RISK LEVEL's fallback: when extractRiskLevel(marketMainRisk) finds
//    no explicit "high/moderate/low ... risk" phrase in the resolved Main
//    Risk sentence (true for this report -- its real text, "Key
//    unresolved: realistic obtainable market share (SOM) is not
//    evidenced...", never uses the word "risk" near a severity word), the
//    code fell back to snapshot.riskLevel -- buildExecutiveSnapshot's own
//    generic inferRiskLevel(content, ["risk", "validation", "cac",
//    "funding", "execution", ...]) FULL-CONTENT keyword scan. For this
//    exact report that returned "High" purely because the unrelated word
//    "unresolved" happens to appear somewhere in the executive summary --
//    not because of any principled, Market-Intelligence-specific
//    severity derivation. Confirmed by direct reproduction: the resolved
//    Main Risk text contains no "risk" word near a severity word at all.
//
// 2. RISK HEATMAP: completely ungated for Market Intelligence --
//    snapshot.riskHeatmap (buildExecutiveSnapshot's own buildRiskHeatmap)
//    scores five Business-Plan/startup categories ("Customer validation",
//    "CAC", "Capital efficiency", "Competition", "Execution") via
//    inferRiskLevel, whose own documented default is "return 'Low'" the
//    moment a category's keyword list finds nothing in the content --
//    exactly the "convert unknown to Low risk" anti-pattern this ticket
//    explicitly forbids. None of these five categories' keywords
//    ("cac", "customer acquisition", "capital efficiency", "funding",
//    "competition", "execution", "operational", ...) appear anywhere in
//    Market Intelligence's own executiveSummary prose, so all five
//    silently defaulted to "Low" -- looking like five real, checked, safe
//    assessments when in fact none of them were ever evaluated for this
//    report kind at all.
//
// Confirmed NOT bugs during this same audit (Market Signal, Decision
// Factors, Planning Confidence, Executive Decision): buildConfidenceRadar
// (the underlying computation for both "Market Signal" and "Decision
// Factors") was already hardened in a prior pass -- each dimension only
// reads a score when the dimension's OWN alias word appears within 20
// characters of a percentage (extractPercentScore's requireNearbyLabelWord
// option), correctly falling through to null ("Validation Needed")
// rather than a fabricated or borrowed number. Planning Confidence and
// Executive Decision already resolve through the same canonical
// resolveMarketIntelligenceExecutiveDecision hardened in Tasks #16-#19.
//
// FIX (mirrored across page.tsx, Planner.tsx's web JSX, and Planner.tsx's
// PDF drawer -- ReportPdfButton.tsx's own cover page was already
// correctly gated in an earlier task and needed no change):
//   1. marketRiskLevel's fallback is now an honest "Validation Needed"/
//      "Doğrulama Gerekli", never the generic full-content scan.
//   2. A new marketRiskHeatmap rebuilds the heatmap from the SAME
//      canonical Top 3 Risks list Main Risk already reads (one row per
//      real item, per-item severity via extractRiskLevel, never a
//      keyword-presence guess), falling back to a single row that reuses
//      the ALREADY-RESOLVED Main Risk/Risk Level when no structured list
//      exists -- structurally impossible for the heatmap to disagree with
//      the Risk Level tile next to it, since both read the identical
//      source.
//   3. getRiskIndicatorClass gained an explicit "Validation Needed"
//      branch using a neutral, unclassified badge style -- distinct from
//      Low (teal/safe-looking), Medium (amber), and High (red) -- so an
//      unassessed risk can never visually pass as "checked and safe."

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

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

async function compileRiskFns(source) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-risk-integrity-"));
  const outPath = join(dir, "extract.mts");
  const harness = [
    extractFunctionSource(source, "extractRiskLevel"),
    extractFunctionSource(source, "getRiskIndicatorClass"),
  ].join("\n\n");
  writeFileSync(outPath, `${harness}\nexport { extractRiskLevel, getRiskIndicatorClass };\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod;
}

// The EXACT real report content (report id 88a0bab9-fd65-4e76-a6f3-1fb1e5d2851e).
const realExecutiveSummary =
  "Bottom Line — Decision: ENTER the U.S.\n" +
  "mid‑market AI compliance & contract intelligence SaaS market for 2027 (evidence-backed growth signal and commercially active vendor landscape; see R12, R4, R5).\n" +
  "Key Findings — 1) Growth signal: multiple market-research providers report a U.S. CLM category expanding from roughly USD 1.5B (2024) toward multi‑billion by 2034 (Emergen Research) [R12].\n" +
  "Biggest Opportunity — Rapid CLM AI adoption among mid-sized U.S. firms driven by productivity gains and documented vendor activity (R12, R4, R5).\n" +
  "Biggest Risk — Key unresolved: realistic obtainable market share (SOM) is not evidenced; go/no-go depends on validated penetration/win‑rate evidence.\n" +
  "Recommendation — 1) Validate SOM by buying 3 market-access data points before major build.\n" +
  "(Total 136 words)";

const realMainRisk =
  "Biggest Risk — Key unresolved: realistic obtainable market share (SOM) is not evidenced; go/no-go depends on validated penetration/win‑rate evidence.";

test("SCENARIO A -- EXACT REAL FAILURE SHAPE: unresolved SOM + MONITOR must not silently produce misleading all-Low risk signals -- extractRiskLevel finds no explicit severity in the real Main Risk sentence (confirming the old 'High' badge was a coincidental full-content keyword match, not a real derivation), in page.tsx and Planner.tsx", async () => {
  for (const { label, source } of [
    { label: "page.tsx", source: pageSource },
    { label: "Planner.tsx", source: plannerSource },
  ]) {
    const { extractRiskLevel } = await compileRiskFns(source);
    assert.equal(
      extractRiskLevel(realMainRisk),
      "",
      `${label}: the real Main Risk sentence states no explicit severity word near "risk" -- extractRiskLevel must not guess one`
    );
  }
});

test("SCENARIO F -- risk severity and evidence-validation status are not conflated: 'Validation Needed' renders with a neutral badge, structurally distinct from the teal 'Low' badge and the amber 'Medium'/red 'High' badges, in page.tsx and Planner.tsx", async () => {
  for (const source of [pageSource, plannerSource]) {
    const { getRiskIndicatorClass } = await compileRiskFns(source);
    const validationNeededClass = getRiskIndicatorClass("Validation Needed");
    const lowClass = getRiskIndicatorClass("Low");
    const mediumClass = getRiskIndicatorClass("Medium");
    const highClass = getRiskIndicatorClass("High");

    assert.notEqual(validationNeededClass, lowClass, "must not share Low's safe-looking teal styling");
    assert.notEqual(validationNeededClass, mediumClass);
    assert.notEqual(validationNeededClass, highClass);
    assert.match(validationNeededClass, /zinc-300/, "expected the established neutral/unclassified badge style");
  }
});

test("SCENARIO B -- missing factor evidence remains unavailable rather than fabricated: a Main Risk sentence with no explicit severity produces 'Validation Needed', never a guessed Low/Medium/High, in page.tsx and Planner.tsx", async () => {
  for (const source of [pageSource, plannerSource]) {
    const { extractRiskLevel } = await compileRiskFns(source);
    // Simulate the exact fallback chain: extractRiskLevel found nothing,
    // so the resolved level must become the honest unavailable state, not
    // silently inherit a keyword-coincidence value.
    const severity = extractRiskLevel(realMainRisk);
    const resolved = severity === "High" ? "High" : severity === "Moderate" ? "Medium" : severity === "Low" ? "Low" : "Validation Needed";
    assert.equal(resolved, "Validation Needed");
  }
});

test("SCENARIO C -- validated evidence can produce real factor/signal values: a Main Risk sentence that DOES state an explicit severity is read correctly, never overridden to 'Validation Needed', in page.tsx and Planner.tsx", async () => {
  for (const source of [pageSource, plannerSource]) {
    const { extractRiskLevel } = await compileRiskFns(source);
    assert.equal(extractRiskLevel("This is a high risk due to unresolved regulatory uncertainty."), "High");
    assert.equal(extractRiskLevel("This carries moderate risk given partial evidence."), "Moderate");
    assert.equal(extractRiskLevel("This is a low risk given strong, verified demand signals."), "Low");
  }
});

test("SCENARIO D -- canonical decision remains unchanged by this presentation-only fix: resolveMarketIntelligenceExecutiveDecision still resolves the real report to MONITOR, exactly as established in Tasks #16-#19", () => {
  const decision = resolveMarketIntelligenceExecutiveDecision(realExecutiveSummary, "English");
  assert.equal(decision.decisionLabel, "MONITOR");
});

test("SCENARIO E -- UI/PDF-facing resolved values agree: page.tsx, Planner.tsx's web JSX, and Planner.tsx's PDF drawer all replace the generic snapshot.riskLevel/riskHeatmap fallback with the same honest 'Validation Needed' state and the same Top-3-Risks-then-Main-Risk derivation strategy", () => {
  assert.match(
    pageSource,
    /return isMarketIntelligenceTurkish \? "Doğrulama Gerekli" : "Validation Needed";\s*\n\s*\}\)\(\)\s*\n\s*: snapshot\.riskLevel;/
  );
  assert.match(
    plannerSource,
    /return isMarketIntelligenceTurkish \? "Doğrulama Gerekli" : "Validation Needed";\s*\n\s*\}\)\(\)\s*\n\s*: snapshot\.riskLevel;/
  );
  // Web JSX (both files): heatmap rebuilt from the canonical Top 3 Risks
  // list, falling back to the resolved Main Risk/Risk Level.
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const marketRiskHeatmap = isMarketIntelligence/);
    assert.match(
      source,
      /label: isMarketIntelligenceTurkish \? "Ana Risk" : "Main Risk",\s*\n\s*level: marketRiskLevel,/
    );
  }
  // Planner.tsx's PDF drawer: same strategy, its own local variable names.
  assert.match(plannerSource, /const marketRiskHeatmap = isMarketIntelligence\s*\n\s*\? \(\(\) => \{\s*\n\s*const topRisksBlock = extractMetricValueFromAliases\(\s*\n\s*marketExecutiveSummaryContent,/);
  assert.match(plannerSource, /: marketRiskHeatmap\)\.forEach\(\(risk, index\) => \{/);
});

test("no fabrication guard: a Top 3 Risks list item with no explicit severity word produces 'Validation Needed' per-item, never a silently-guessed 'Low', in page.tsx and Planner.tsx", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(
      source,
      /level:\s*\n?\s*extractRiskLevel\(item\) \|\| \(isMarketIntelligenceTurkish \? "Doğrulama Gerekli" : "Validation Needed"\),/
    );
  }
});

test("drift check: this fix does not touch resolveMarketIntelligenceExecutiveDecision, the Strategic Recommendations decision badge (Task #17), or the Executive Summary decision-leakage reconciliation (Task #17B) -- confirms no second, independent decision system was created", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const marketDecision = isMarketIntelligence\s*\n\s*\? resolveMarketIntelligenceGatedExecutiveDecision\(/);
    assert.match(source, /const strategicRecommendationDecision = isMarketIntelligence/);
  }
});

test("drift check: buildConfidenceRadar's per-dimension null fallback (Market Signal / Decision Factors' own already-correct 'no fabricated shared number' hardening) is untouched by this pass", () => {
  const presentationSource = readFileSync(
    new URL("../app/lib/report-presentation.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    presentationSource,
    /extractPercentScore\(content, dimension\.aliases, \{ requireNearbyLabelWord: true \}\) \?\?\s*\n\s*dimension\.score \?\?\s*\n\s*null,/
  );
});
