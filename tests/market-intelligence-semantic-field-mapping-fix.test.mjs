import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Regression coverage for ticket: "Fix the semantic field-mapping and
// evidence-status integrity bugs in the ZERINIX Market Intelligence
// report", reproducing the exact reported U.S. AI construction SaaS
// defects:
//
//   1. Market Size showed a pricing/ARPA figure ($2K-$10K) as a "Data
//      Confirmed" market-size number.
//   2. Market Size must fall back to "Validation Needed" (matching
//      TAM/SAM/SOM) when no defensible market-size figure exists.
//   3. Evidence-status labels must reflect real evidence, never default
//      to "verified" for an unlabeled/hedged figure.
//   4. Malformed extraction artifacts ("Why: The opportunity -- "1)")
//      must not survive into executive fields.
//   5. Market Signal/Main Risk/Why/Next Action/executive highlights must
//      use semantically appropriate canonical fields, not arbitrary
//      keyword-scanned prose.

const pageSource = readFileSync("app/dashboard/[id]/page.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const marketPresentationSource = readFileSync(
  "app/lib/report-engine/market-intelligence-presentation.ts",
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

function extractConstSource(source, name) {
  const match = source.match(new RegExp(`const ${name} =[\\s\\S]*?;\\n`));
  assert.ok(match, `${name} not found`);
  return match[0];
}

async function compileModule(pieces, exportNames) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-semantic-field-mapping-"));
  const outPath = join(dir, "module.ts");
  writeFileSync(outPath, `${pieces.join("\n\n")}\n\nexport { ${exportNames.join(", ")} };\n`);
  return import(pathToFileURL(outPath).href);
}

// --- Defect 1/2: Market Size must never show a pricing/ARPA figure -----

const MARKET_SIZE_ARPA_CONTENT =
  "The total addressable market size could not be independently verified from authoritative sources and still requires validation. As a planning reference only, SMB customers in this segment typically pay $2K-$10K annually (ARPA), which could inform a bottom-up estimate once real market sizing data becomes available.";

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: extractHeadlineMonetaryValue never returns a pricing/ARPA figure as the market-size headline -- reproduces the exact reported defect ($2K-$10K SMB ARPA assumption)`, async () => {
    const exclusionConst = extractConstSource(source, "marketSizeExclusionContext");
    const positiveConst = extractConstSource(source, "marketSizePositiveContext");
    const raw = extractFunctionSource(source, "extractHeadlineMonetaryValue");
    const mod = await compileModule([exclusionConst, positiveConst, raw], ["extractHeadlineMonetaryValue"]);

    const value = mod.extractHeadlineMonetaryValue(MARKET_SIZE_ARPA_CONTENT);
    assert.equal(value, "", "the ARPA figure must never be returned as the market-size value");
  });

  test(`${label}: REGRESSION (ticket 3, exact reported phrasing) -- extractHeadlineMonetaryValue never returns a per-buyer purchase/revenue figure for an AI module as the market-size headline`, async () => {
    const exclusionConst = extractConstSource(source, "marketSizeExclusionContext");
    const positiveConst = extractConstSource(source, "marketSizePositiveContext");
    const raw = extractFunctionSource(source, "extractHeadlineMonetaryValue");
    const mod = await compileModule([exclusionConst, positiveConst, raw], ["extractHeadlineMonetaryValue"]);

    const content =
      "The SMB annual per-buyer purchase/revenue assumption for the AI module is $2K-$10K, based on comparable SaaS pricing. A verified exact U.S. market-size figure is not available from independent sources.";
    const value = mod.extractHeadlineMonetaryValue(content);
    assert.equal(value, "", "the per-buyer purchase figure must never be returned as the market-size value");
  });

  test(`${label}: extractHeadlineMonetaryValue still returns a genuine total-market-size figure when one is actually present, even alongside an excluded pricing figure (never globally suppresses real market-size values)`, async () => {
    const exclusionConst = extractConstSource(source, "marketSizeExclusionContext");
    const positiveConst = extractConstSource(source, "marketSizePositiveContext");
    const raw = extractFunctionSource(source, "extractHeadlineMonetaryValue");
    const mod = await compileModule([exclusionConst, positiveConst, raw], ["extractHeadlineMonetaryValue"]);

    const content =
      "The total addressable market for AI construction SaaS in the U.S. is estimated at $4.2 billion. SMB customers typically pay $2K-$10K annually (ARPA), which is not the total market figure.";
    const value = mod.extractHeadlineMonetaryValue(content);
    assert.equal(value, "$4.2 billion");
  });

  test(`${label}: extractHeadlineMonetaryValue still finds an ordinary, unhedged market-size figure with no pricing language present at all (regression guard -- the exclusion filter must not misfire on normal content)`, async () => {
    const exclusionConst = extractConstSource(source, "marketSizeExclusionContext");
    const positiveConst = extractConstSource(source, "marketSizePositiveContext");
    const raw = extractFunctionSource(source, "extractHeadlineMonetaryValue");
    const mod = await compileModule([exclusionConst, positiveConst, raw], ["extractHeadlineMonetaryValue"]);

    const content = "The U.S. market for AI-powered construction SaaS is valued at $1.8B as of this year.";
    const value = mod.extractHeadlineMonetaryValue(content);
    assert.equal(value, "$1.8B");
  });

  test(`${label}: extractHeadlineMonetaryValue requires POSITIVE market-sizing confirmation, not just the absence of exclusion keywords -- an unlabeled dollar figure with no market-sizing language nearby at all must fail closed rather than being guessed`, async () => {
    const exclusionConst = extractConstSource(source, "marketSizeExclusionContext");
    const positiveConst = extractConstSource(source, "marketSizePositiveContext");
    const raw = extractFunctionSource(source, "extractHeadlineMonetaryValue");
    const mod = await compileModule([exclusionConst, positiveConst, raw], ["extractHeadlineMonetaryValue"]);

    const content =
      "Construction firms have historically underinvested in software tooling. A recent industry survey noted that $500 was spent on a related conference sponsorship last year.";
    const value = mod.extractHeadlineMonetaryValue(content);
    assert.equal(value, "", "an unrelated dollar figure with no market-sizing language nearby must never be guessed as market size");
  });
}

// --- Defect 3: evidence-status must never default to "verified" --------

test("page.tsx and Planner.tsx: the Market Size/CAGR card no longer classifies evidence via a binary '[Estimated]' literal-tag check that defaults everything else to 'verified' -- it reuses the shared canonical evidence classifier (inferEvidenceLevel), whose default is 'benchmarkDerived', never 'verified'", () => {
  for (const [label, source] of [["page.tsx", pageSource], ["Planner.tsx", plannerSource]]) {
    assert.doesNotMatch(
      source.match(/if \(normalizedTitle\.includes\("market size"\)[\s\S]{0,900}/)?.[0] ||
        source.match(/if \(field === "marketSize" \|\| field === "cagr"\)[\s\S]{0,900}/)?.[0] ||
        "",
      /isEstimated \? "benchmarkDerived" : "verified"/,
      `${label}: the old binary evidence default must be gone`
    );
  }
  // P0 FIX #5 (source/evidence integrity repair) scoped page.tsx's
  // `content` argument to extractEvidenceLineForValue(content, value) --
  // see tests/market-intelligence-source-evidence-integrity.test.mjs.
  // Planner.tsx (Business Plan/Acquisition, out of scope for that
  // Market-Intelligence-specific fix) keeps its original, unscoped call.
  // P0 FIX #8 -- confirmed live (CAGR scope/KPI semantics repair): a
  // multi-estimate CAGR range is forced to "benchmarkDerived" before
  // reaching the classifier below (no single evidence line supports a
  // two-number range); the single-estimate case this test protects still
  // routes through this exact pinned getDashboardMetricEvidence(...) call.
  assert.match(
    pageSource,
    /const evidence =\s*\n\s*isCagr && cagrPresentation\?\.isMultiEstimate\s*\n\s*\?\s*\("benchmarkDerived" as const\)\s*\n\s*:\s*getDashboardMetricEvidence\(\s*\n\s*isCagr \? "CAGR" : "Market Size",\s*\n\s*value,\s*\n\s*extractEvidenceLineForValue\(content, value\)\s*\n\s*\);/
  );
  assert.match(
    plannerSource,
    /const evidence = inferEvidenceLevel\(\{\s*\n\s*label: isCagr \? "CAGR" : "Market Size",\s*\n\s*value,\s*\n\s*context: section\.content,\s*\n\s*\}\);/
  );
});

test("report-evidence.ts: inferEvidenceLevel's own default for unlabeled/ambiguous context is 'benchmarkDerived', never 'verified' -- the canonical classifier both Market Size and TAM/SAM/SOM now share", async () => {
  const source = readFileSync("app/lib/report-evidence.ts", "utf8");
  const raw = extractFunctionSource(source, "inferEvidenceLevel").replace(/: [^,)]+(?=[,)])/g, "").replace(/\): [^{]+\{/, ") {");
  const mod = await compileModule([raw], ["inferEvidenceLevel"]);

  const result = mod.inferEvidenceLevel({
    label: "Market Size",
    value: "$4.2 billion",
    context: "The U.S. market for AI-powered construction SaaS is valued at $4.2 billion.",
  });
  assert.equal(result, "benchmarkDerived", "an unlabeled figure with no explicit verification language must not default to verified");

  const hedged = mod.inferEvidenceLevel({
    label: "Market Size",
    value: "$4.2 billion",
    context: "Market sizing still needs validation from an authoritative source; $4.2 billion is a preliminary estimate.",
  });
  assert.equal(hedged, "validationRequired");
});

// --- Defect 4: malformed extraction artifacts -----------------------

test("REGRESSION (exact reported artifact shape): market-intelligence-presentation.ts's splitIntoCandidateSentences no longer leaves a dangling quote+bare-numbered-marker fragment ('The opportunity -- \"1)') as a selectable candidate -- it correctly splits the quoted inline enumeration and selects the first REAL, complete sentence instead", async () => {
  const abbreviations = extractConstSource(marketPresentationSource, "SENTENCE_BOUNDARY_ABBREVIATIONS");
  const protectFn = extractFunctionSource(marketPresentationSource, "protectSentenceBoundaryAbbreviations");
  const restoreFn = extractFunctionSource(marketPresentationSource, "restoreSentenceBoundaryAbbreviations");
  const splitFn = extractFunctionSource(marketPresentationSource, "splitIntoCandidateSentences");
  const headingFn = extractFunctionSource(marketPresentationSource, "isHeadingOnlyLine");
  const substantiveFn = extractFunctionSource(marketPresentationSource, "isSubstantive");
  const firstFn = extractFunctionSource(marketPresentationSource, "firstSubstantiveLine");

  const mod = await compileModule(
    [abbreviations, protectFn, restoreFn, splitFn, headingFn, substantiveFn, firstFn],
    ["splitIntoCandidateSentences", "firstSubstantiveLine", "isSubstantive"]
  );

  const content =
    'The opportunity -- "1) Construction firms in the U.S. are actively seeking AI-driven SaaS tools to reduce project overruns and improve scheduling accuracy. 2) Early movers can establish a strong market position before larger incumbents enter the SMB segment. 3) Recurring SaaS revenue models offer durable margins."';

  const candidates = mod.splitIntoCandidateSentences(content);
  // The split itself must produce a clean lead-in fragment (isSubstantive
  // -- checked separately below -- is what actually filters it out of
  // consideration; the split's own job is just to separate it cleanly
  // from the real sentence that follows, with no artifact attached).
  assert.ok(
    candidates.some((candidate) => /^The opportunity\s*--?\s*$/.test(candidate)),
    `expected the lead-in to split out cleanly as its own fragment, got ${JSON.stringify(candidates)}`
  );
  assert.ok(
    !candidates.some((candidate) => mod.isSubstantive(candidate) && /^The opportunity/.test(candidate)),
    `the lead-in fragment must not be treated as substantive, got ${JSON.stringify(candidates)}`
  );
  assert.ok(
    !candidates.some((candidate) => /"1\)$/.test(candidate) || /^"?\d\)/.test(candidate)),
    `no candidate may retain a bare quote+numbered-marker artifact, got ${JSON.stringify(candidates)}`
  );

  const result = mod.firstSubstantiveLine(content);
  assert.doesNotMatch(result, /^The opportunity\s*--?\s*"?1\)/, `must not select the malformed fragment, got ${JSON.stringify(result)}`);
  assert.match(result, /Construction firms in the U\.S\. are actively seeking/);
  // The abbreviation "U.S." must survive intact, not truncate the sentence.
  assert.match(result, /reduce project overruns and improve scheduling accuracy\.$/);
});

test("market-intelligence-presentation.ts: splitIntoCandidateSentences still correctly splits the ORIGINAL parenthesized numbering shape '(1)' (regression guard -- the broadened marker pattern must not break the already-working case)", async () => {
  const abbreviations = extractConstSource(marketPresentationSource, "SENTENCE_BOUNDARY_ABBREVIATIONS");
  const protectFn = extractFunctionSource(marketPresentationSource, "protectSentenceBoundaryAbbreviations");
  const restoreFn = extractFunctionSource(marketPresentationSource, "restoreSentenceBoundaryAbbreviations");
  const splitFn = extractFunctionSource(marketPresentationSource, "splitIntoCandidateSentences");

  const mod = await compileModule([abbreviations, protectFn, restoreFn, splitFn], ["splitIntoCandidateSentences"]);

  const content = "Key risks: (1) Regulatory uncertainty remains high. (2) Customer acquisition costs are rising sharply.";
  const candidates = mod.splitIntoCandidateSentences(content);
  assert.ok(candidates.some((c) => /^Regulatory uncertainty remains high\.$/.test(c)));
  assert.ok(candidates.some((c) => /^Customer acquisition costs are rising sharply\.$/.test(c)));
});

test("market-intelligence-presentation.ts: splitIntoCandidateSentences does not misread a mid-sentence abbreviation ('U.S.', 'Inc.') as a sentence boundary in ordinary (non-numbered) prose", async () => {
  const abbreviations = extractConstSource(marketPresentationSource, "SENTENCE_BOUNDARY_ABBREVIATIONS");
  const protectFn = extractFunctionSource(marketPresentationSource, "protectSentenceBoundaryAbbreviations");
  const restoreFn = extractFunctionSource(marketPresentationSource, "restoreSentenceBoundaryAbbreviations");
  const splitFn = extractFunctionSource(marketPresentationSource, "splitIntoCandidateSentences");

  const mod = await compileModule([abbreviations, protectFn, restoreFn, splitFn], ["splitIntoCandidateSentences"]);

  const content = "Procore Inc. and Autodesk Construction Cloud dominate the U.S. enterprise segment today.";
  const candidates = mod.splitIntoCandidateSentences(content);
  assert.deepEqual(candidates, ["Procore Inc. and Autodesk Construction Cloud dominate the U.S. enterprise segment today."]);
});

test("isHeadingOnlyLine rejects a fragment left dangling by a marker split (ends in a dash/colon/quote with nothing after), regardless of length", async () => {
  const headingFn = extractFunctionSource(marketPresentationSource, "isHeadingOnlyLine");
  const mod = await compileModule([headingFn], ["isHeadingOnlyLine"]);

  assert.equal(mod.isHeadingOnlyLine("The opportunity --"), true);
  assert.equal(mod.isHeadingOnlyLine("The following risks were identified:"), true);
  assert.equal(mod.isHeadingOnlyLine("A complete, substantive sentence about the market opportunity."), false);
});

// --- Defect 5: Market Signal / Risk Posture / highlights / Next Action -

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: the Executive Summary card's "Market Signal" KPI no longer scans the whole executive summary for any line starting with "Market"/"TAM" for Market Intelligence -- there is no reliable canonical source for it in the deterministic banner, so it shows the neutral placeholder directly instead of guessing from arbitrary prose`, () => {
    assert.match(
      source,
      /value: isMarketIntelligence\s*\n\s*\? (?:"Review"|"—")\s*\n\s*: extractMetricValue\([^,]+, "Market"\) \|\| extractMetricValue\([^,]+, "TAM"\) \|\| (?:"Review"|"—"),/
    );
  });

  test(`${label}: the Executive Summary card's "Risk Posture" KPI reads Market Intelligence's real, labeled "Top 3 Risks" field (locale-agnostic, matching the PDF's own Executive Decision card) instead of an unlabeled "any line starting with Risk" scan`, () => {
    assert.match(
      source,
      /value: isMarketIntelligence\s*\n\s*\? takeFirstListItem\(extractMetricValueFromAliases\([^,]+, localizedLabelVariants\("topRisks"\)\)\) \|\| "Tracked"/
    );
  });

  test(`${label}: executive highlights source from the deterministic banner's real Why/Top 3 Risks/Immediate Next Action/Missing Evidence fields for Market Intelligence, not a generic keyword scan whose own fallback (first line of the section) can surface an unrelated sentence`, () => {
    assert.match(source, /function getMarketIntelligenceExecutiveHighlights\(content: string\)/);
    const fnBody = extractFunctionSource(source, "getMarketIntelligenceExecutiveHighlights");
    assert.match(fnBody, /localizedLabelVariants\("why"\)/);
    assert.match(fnBody, /localizedLabelVariants\("topRisks"\)/);
    assert.match(fnBody, /localizedLabelVariants\("immediateNextAction"\)/);
    assert.match(fnBody, /localizedLabelVariants\("missingEvidence"\)/);
  });

  test(`${label}: the highlights call site branches on isMarketIntelligence to the new canonical builder`, () => {
    assert.match(
      source,
      /const highlights = isMarketIntelligence\s*\n\s*\? getMarketIntelligenceExecutiveHighlights\([^)]+\)\s*\n\s*: getExecutiveHighlights\([^)]+\);/
    );
  });
}

test("page.tsx: getDecisionSummaryItems reads Market Intelligence's real 'Immediate Next Action'/'Top 3 Risks' labeled fields before ever falling back to a bare keyword scan across the ENTIRE report (fullContent) -- the scan that could surface a wholly unrelated sentence as 'the' next action or main risk", () => {
  assert.match(
    pageSource,
    /const marketNextAction = isMarketIntelligence\s*\n\s*\? extractMetricValueFromAliases\([^,]+, localizedLabelVariants\("immediateNextAction"\)\)\s*\n\s*: "";/
  );
  assert.match(
    pageSource,
    /const marketMainRisk = isMarketIntelligence\s*\n\s*\? takeFirstListItem\(extractMetricValueFromAliases\([^,]+, localizedLabelVariants\("topRisks"\)\)\)\s*\n\s*: "";/
  );
  // The generic fullContent keyword-scan fallback is now explicitly
  // skipped for Market Intelligence (isMarketIntelligence ? "" : ...),
  // never reached once the labeled extraction has already been tried.
  assert.match(pageSource, /\(isMarketIntelligence\s*\n\s*\? ""\s*\n\s*: extractKeywordInsight\(executiveRecommendation \|\| executiveSummary \|\| fullContent, \[\s*\n\s*"next",/);
  assert.match(pageSource, /\(isMarketIntelligence\s*\n\s*\? ""\s*\n\s*: extractKeywordInsight\(risks \|\| fullContent, \["risk", "threat", "regulation", "competition"\]\)\);/);
});

test("page.tsx: cleanDecisionSummaryText correctly falls back to its own neutral placeholder text when the Market Intelligence labeled extraction finds nothing at all (fail-closed -- never a blank UI element)", () => {
  assert.match(pageSource, /cleanDecisionSummaryText\(mainRisk, "Risk profile is detailed in the report\."\)/);
  assert.match(pageSource, /cleanDecisionSummaryText\(nextStep, "Create a follow-up validation plan\."\)/);
});

// --- Drift checks: TAM/SAM/SOM's already-correct behavior is untouched -

test("DRIFT CHECK: TAM/SAM/SOM's own labeled extraction and nesting/validation-needed logic are untouched by this ticket's Market Size fixes", () => {
  assert.match(pageSource, /function extractMarketSizeCardValue/);
  assert.match(plannerSource, /function extractMarketSizeValue/);
  assert.match(pageSource, /const tamResolved = magnitudes\[0\] !== null;/);
});

test("DRIFT CHECK: the Competitive Landscape names-only fallback tier (extractMarketIntelligenceCompetitorNamesOnly, from the prior ticket) is untouched", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function extractMarketIntelligenceCompetitorNamesOnly/);
  }
});

test("DRIFT CHECK: market-intelligence-graph.ts's Major Players / Competitive Landscape evidence-coverage fallback (describeCompetitiveCoverage) already explains a genuine 'insufficient major players, but validated vendors remain in Competitive Landscape' split truthfully -- the insufficientMajorPlayers text is only ever reached when renderableVendors.length > 0 already populated the Competitive Landscape table, so its own claim is never false", () => {
  const graphSource = readFileSync("app/lib/ai/market-intelligence-graph.ts", "utf8");
  assert.match(graphSource, /function describeCompetitiveCoverage/);
  assert.match(
    graphSource,
    /insufficientMajorPlayers:\s*\n\s*"Insufficient independent evidence for Major Players ranking; validated commercial vendors remain available in the Competitive Landscape\."/
  );
  // insufficientMajorPlayers is only assigned inside the renderableVendors.length > 0 branch.
  const majorPlayersBlock = graphSource.match(/if \(renderableVendors\.length > 0\) \{[\s\S]*?\n  \} else \{/)?.[0];
  assert.ok(majorPlayersBlock, "expected the renderableVendors > 0 branch");
  assert.match(majorPlayersBlock, /projection\.majorPlayers = copy\.insufficientMajorPlayers;/);
});
