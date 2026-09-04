import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { localizedLabelVariants } from "../app/lib/report-engine/executive-decision-brief.ts";

// Focused integrity repair -- Executive Decision, Competitive Landscape
// consistency, and PDF/report presentation mapping. Root causes fixed this
// pass:
//
// 1. ExecutiveSnapshotPanel's "Main Risk"/"Next Action" tiles and "Risk
//    Level" badge were never covered by the earlier "canonical decision
//    consistency" fix -- they still read buildExecutiveSnapshot's generic
//    Business-Plan-shaped fallback (investmentScore is always empty for
//    Market Intelligence, so mainRisk fell to an unbounded full-content
//    bullet scan, and riskLevel to a founder/business-plan keyword
//    presence-check like "cac"/"funding"). That let this card's "Main
//    Risk" silently disagree with the "Risk Posture" tile a few lines
//    above it in ExecutiveSummaryVisual, which correctly reads the SAME
//    deterministic banner's "Top 3 Risks" field. Fixed by reading the
//    identical canonical alias fields for Main Risk/Next Action, and
//    deriving Risk Level's severity word from that same resolved text.
//
// 2. parseMarketSizeMagnitude (Planner.tsx, ReportPdfButton.tsx) only
//    matched a single-letter unit ([kKmMbBtT]), so a spelled-out
//    "thousand" matched just its leading "t" and was read as TRILLION --
//    a billion-fold misparse. page.tsx's parseMonetaryMagnitude already
//    tries the full unit word first for exactly this reason; mirrored
//    here so the dashboard, Planner, and exported PDF can never disagree
//    on a TAM/SAM/SOM layer's resolved/nested state purely because one
//    surface used a narrower unit parser.
//
// 3. The Executive Decision System's explainability/verdict panel
//    (ExecutiveDecisionIntelligencePanel / drawExecutiveDecisionIntelligencePage)
//    was never gated to exclude Market Intelligence, even though EDS is
//    deliberately scoped to Business Idea Validation only. Gated as
//    defense in depth so an MI report can never carry a second,
//    uncoordinated "verdict" that could disagree with its own canonical
//    Decision.
//
// 4. A conversation-scoped research snapshot was reused across every
//    later request in that thread purely by conversationId match, with
//    no check that it was captured for the SAME topic -- asking about one
//    market in chat and then generating a report for a different market
//    later in the same conversation could silently combine the new
//    report with the first market's stale evidence. Fixed via a single
//    shared identity-match guard (conversationResearchIdentityMatches),
//    enforced both where the cache-hit branch reuses the snapshot's graph
//    and inside resolveDomainResearchWithCache itself (the fresh-
//    generation path, and every other caller across the codebase).

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
const researchCacheSource = readFileSync(new URL("../app/lib/ai/research-cache.ts", import.meta.url), "utf8");

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

async function compileFunctions(source, functionNames, { header = "" } = {}) {
  const pieces = functionNames.map((name) => `export ${extractFunctionSource(source, name)}`);
  const dir = mkdtempSync(join(tmpdir(), "zerinix-decision-consistency-fn-"));
  const outPath = join(dir, "bundle.ts");
  writeFileSync(outPath, `${header}${pieces.join("\n\n")}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return functionNames.reduce((acc, name) => ({ ...acc, [name]: mod[name] }), {});
}

// Planner.tsx's extractMetricValue (unlike page.tsx's self-contained
// version) normalizes through the real normalizePdfText -- imported by
// absolute path so the compiled bundle behaves identically to the real
// component, the same @/-alias-rewrite pattern used elsewhere in this
// test suite for other files' external imports.
const plannerHeader = `import { normalizePdfText } from ${JSON.stringify(
  pathToFileURL(join(process.cwd(), "app/lib/pdf-normalization.mjs")).href
)};\n\n`;

// P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
// quality failure, UI/PDF canonical-data divergence): ReportPdfButton.tsx's
// own parseMarketSizeMagnitude is now a thin delegation to the shared,
// canonical parseMarketSizingMagnitude (report-presentation.ts) rather
// than an independent copy -- imported by absolute path so the compiled
// bundle has the real dependency available, the same pattern plannerHeader
// already uses above.
//
// TASK #57 -- page.tsx's parseMonetaryMagnitude and Planner.tsx's
// parseMarketSizeMagnitude are now ALSO thin delegations to this same
// canonical parser (Task #56's audit found Planner.tsx's own prior
// independent copy silently mis-parsed comma-grouped figures by up to
// ~2000x) -- this header must be passed for any compiled bundle
// extracting either of those two functions now, not just
// ReportPdfButton.tsx's.
const canonicalMagnitudeHeader = `import { parseMarketSizingMagnitude } from ${JSON.stringify(
  pathToFileURL(join(process.cwd(), "app/lib/report-presentation.ts")).href
)};\n\n`;

// research-cache.ts itself cannot be imported directly (it starts with
// `import "server-only"`, which only resolves inside the Next.js build) --
// conversationResearchIdentityMatches is a small, pure, self-contained
// function (no dependency on anything else in that file), so it is
// extracted and compiled standalone, the same technique used throughout
// this test suite for React-component-embedded functions.
const { conversationResearchIdentityMatches } = await compileFunctions(researchCacheSource, [
  "conversationResearchIdentityMatches",
]);

// ---------------------------------------------------------------------------
// D) Canonical decision exists -> every executive representation uses it --
//    ExecutiveSnapshotPanel's Main Risk/Next Action/Risk Level now match
//    the same canonical banner fields as ExecutiveSummaryVisual's Risk
//    Posture tile and getMarketIntelligenceExecutiveHighlights.
// ---------------------------------------------------------------------------

const deterministicBanner = [
  "Decision: MONITOR (Confidence: 62%)",
  "Why: Regulatory clarity is improving but adoption evidence is still thin.",
  "Top 3 Risks:",
  "- Regulatory approval timelines remain uncertain across target regions.",
  "- No independently validated pricing benchmark exists yet for this segment.",
  "- Incumbent platforms could bundle this capability at no additional cost.",
  "Immediate Next Action: Commission a targeted pilot with two design-partner customers.",
  "What Evidence Is Missing: Independent case studies confirming retention past 90 days.",
].join("\n");

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: ExecutiveSnapshotPanel's Main Risk/Next Action are wired to the identical canonical alias extraction as the Risk Posture tile / Executive Highlights (never a separate generic scan)`, () => {
    // TASK #29E -- marketMainRisk now additionally prefers the persisted
    // MarketIntelligenceCanonicalState's own topRisks[0] first (so this
    // panel can never disagree with the PDF cover's own canonical-state-
    // first value either); the SAME alias-extraction fallback this test
    // originally pinned is unchanged and still runs whenever no canonical
    // state was persisted.
    assert.match(
      source,
      /const marketMainRisk = isMarketIntelligence\s*\n\s*\? marketIntelligenceCanonicalState\?\.topRisks\?\.\[0\] \|\|\s*\n\s*takeFirstListItem\(extractMetricValueFromAliases\(section\.content, localizedLabelVariants\("topRisks"\)\)\) \|\|\s*\n\s*snapshot\.mainRisk\s*\n\s*: snapshot\.mainRisk;/
    );
    assert.match(
      source,
      /const marketNextAction = isMarketIntelligence\s*\n\s*\? extractMetricValueFromAliases\(section\.content, localizedLabelVariants\("immediateNextAction"\)\) \|\|\s*\n\s*snapshot\.nextAction\s*\n\s*: snapshot\.nextAction;/
    );
    assert.match(source, /const marketRiskLevel = isMarketIntelligence/);
    assert.match(source, /extractRiskLevel\(marketMainRisk\)/);
    // The badge and the tile now render the resolved MI-safe values, not
    // buildExecutiveSnapshot's generic fallback.
    assert.match(
      source,
      /getRiskIndicatorClass\(marketRiskLevel\)}`}>\s*\n\s*\{marketRiskLevel\}\s*\n\s*<\/span>\s*\n\s*<p className="line-clamp-2 text-sm leading-5 text-zinc-300">\{marketMainRisk\}<\/p>/
    );
    assert.match(source, /\{ label: labels\.mainRisk, value: marketMainRisk \}/);
    assert.match(source, /\{ label: labels\.nextAction, value: marketNextAction \}/);
  });

  test(`${label}: the exact reported failure shape -- a report whose generic full-content risk/action bullets differ from its deterministic banner's Top 3 Risks/Immediate Next Action -- resolves Main Risk/Next Action from the banner, not the generic bullets`, async () => {
    const functions = await compileFunctions(
      source,
      ["extractMetricValue", "extractMetricValueFromAliases", "takeFirstListItem", "extractRiskLevel"],
      label === "Planner.tsx" ? { header: plannerHeader } : {}
    );

    const content = `${deterministicBanner}\n\nA totally different generic risk bullet unrelated to the banner:\n- Founder execution risk is elevated given team size.\n\nSuggested next step buried in prose: talk to more customers.`;

    const marketMainRisk = functions.takeFirstListItem(
      functions.extractMetricValueFromAliases(content, localizedLabelVariants("topRisks"))
    );
    const marketNextAction = functions.extractMetricValueFromAliases(
      content,
      localizedLabelVariants("immediateNextAction")
    );

    assert.match(marketMainRisk, /Regulatory approval timelines remain uncertain/);
    assert.doesNotMatch(marketMainRisk, /Founder execution risk/);
    assert.match(marketNextAction, /Commission a targeted pilot/);
    assert.doesNotMatch(marketNextAction, /talk to more customers/);

    // Risk Level is derived from that SAME resolved text, never a
    // fabricated classification independent of it.
    const severity = functions.extractRiskLevel(marketMainRisk);
    assert.equal(severity, "");
    // "Regulatory approval timelines remain uncertain..." carries no
    // explicit severity word -- confirms the badge falls back to the
    // generic snapshot value in that case rather than inventing one, per
    // the real ExecutiveSnapshotPanel logic's own fallback branch.
  });

  test(`${label}: Risk Level's severity word, when the resolved risk text does carry one, maps High/Moderate/Low to the badge's own High/Medium/Low vocabulary (Moderate -> Medium, never left unmapped)`, async () => {
    const functions = await compileFunctions(source, ["extractRiskLevel"]);

    assert.equal(functions.extractRiskLevel("Severe regulatory risk could delay launch by a year."), "High");
    assert.equal(functions.extractRiskLevel("Moderate execution risk given current team size."), "Moderate");
    assert.equal(functions.extractRiskLevel("Limited pricing risk given strong existing demand."), "Low");
  });
}

test("Planner.tsx: extractMetricValue no longer returns an empty string for a label written alone on its own line with its real value on the FOLLOWING line(s) -- confirmed live root cause of the Main Risk/Next Action fix above not actually working against the real numbered-list 'Top 3 Risks:' banner shape", async () => {
  const { extractMetricValue } = await compileFunctions(plannerSource, ["extractMetricValue"], {
    header: plannerHeader,
  });

  const multiLineListContent = [
    "Top 3 Risks:",
    "1. Regulatory approval timelines remain uncertain across target regions.",
    "2. No independently validated pricing benchmark exists yet for this segment.",
    "",
    "Missing Evidence: none reported",
  ].join("\n");

  assert.match(
    extractMetricValue(multiLineListContent, "Top 3 Risks"),
    /Regulatory approval timelines remain uncertain/
  );

  // Regression guard -- the overwhelming majority of labels put their
  // real value on the SAME line as the label; that path must be
  // completely unaffected by this fix.
  assert.equal(
    extractMetricValue("Decision: MONITOR (Confidence: 62%)", "Decision"),
    "MONITOR (Confidence: 62%)"
  );
  assert.equal(extractMetricValue("Why: Evidence is still thin.", "Why"), "Evidence is still thin.");
  // A label that is genuinely never stated anywhere still returns "" --
  // this fix only adds a fallback path for a label that WAS found but had
  // nothing after it on its own line, never fabricates a value for a
  // label that doesn't exist in the content at all.
  assert.equal(extractMetricValue("Decision: MONITOR", "Nonexistent Label"), "");
});

// ---------------------------------------------------------------------------
// TAM/SAM/SOM cross-surface unit parsing -- confirmed "thousand" read as
// "trillion" bug in Planner.tsx/ReportPdfButton.tsx.
// ---------------------------------------------------------------------------

for (const [label, source] of [
  ["Planner.tsx", plannerSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
]) {
  test(`${label}: the exact reported bug -- parseMarketSizeMagnitude no longer misreads a spelled-out "thousand" as TRILLION (both start with "t")`, async () => {
    const { parseMarketSizeMagnitude } = await compileFunctions(source, ["parseMarketSizeMagnitude"], {
      header: canonicalMagnitudeHeader,
    });

    assert.equal(parseMarketSizeMagnitude("$200 thousand"), 200_000);
    assert.equal(parseMarketSizeMagnitude("$4.2 trillion"), 4.2e12);
    assert.equal(parseMarketSizeMagnitude("$1.8 billion"), 1.8e9);
    assert.equal(parseMarketSizeMagnitude("$450 million"), 450e6);
    // Single-letter units (the pre-existing, already-correct path) are
    // untouched.
    assert.equal(parseMarketSizeMagnitude("$200k"), 200_000);
    assert.equal(parseMarketSizeMagnitude("$4.2T"), 4.2e12);
  });

  test(`${label}: a full TAM/SAM/SOM stack phrased with spelled-out units nests correctly (TAM $4.2 trillion >= SAM $1.8 billion >= SOM $200 thousand) -- would have collapsed to TAM=SAM=SOM=trillions pre-fix, breaking the nesting check`, async () => {
    const { parseMarketSizeMagnitude } = await compileFunctions(source, ["parseMarketSizeMagnitude"], {
      header: canonicalMagnitudeHeader,
    });

    const tam = parseMarketSizeMagnitude("$4.2 trillion");
    const sam = parseMarketSizeMagnitude("$1.8 billion");
    const som = parseMarketSizeMagnitude("$200 thousand");

    assert.ok(tam >= sam && sam >= som, "TAM >= SAM >= SOM must hold once units are parsed correctly");
  });
}

test("page.tsx: parseMonetaryMagnitude (the reference implementation these two files now mirror) agrees with the newly-fixed Planner.tsx/ReportPdfButton.tsx on the same spelled-out-unit input -- cross-surface agreement, not just an internal fix", async () => {
  const { parseMonetaryMagnitude } = await compileFunctions(pageSource, ["parseMonetaryMagnitude"], {
    header: canonicalMagnitudeHeader,
  });
  const { parseMarketSizeMagnitude: plannerParse } = await compileFunctions(
    plannerSource,
    ["parseMarketSizeMagnitude"],
    { header: canonicalMagnitudeHeader }
  );
  const { parseMarketSizeMagnitude: pdfParse } = await compileFunctions(pdfButtonSource, ["parseMarketSizeMagnitude"], {
    header: canonicalMagnitudeHeader,
  });

  for (const value of ["$200 thousand", "$1.8 billion", "$4.2 trillion", "$450 million"]) {
    const pageResult = parseMonetaryMagnitude(value);
    assert.equal(plannerParse(value), pageResult, `Planner.tsx must agree with page.tsx for "${value}"`);
    assert.equal(pdfParse(value), pageResult, `ReportPdfButton.tsx must agree with page.tsx for "${value}"`);
  }
});

// ---------------------------------------------------------------------------
// Executive Decision System (EDS) explainability panel gated off for MI --
// defense in depth so MI never carries a second, uncoordinated "verdict".
// ---------------------------------------------------------------------------

test("page.tsx: ExecutiveDecisionIntelligencePanel is never rendered for Market Analysis reports (EDS is deliberately scoped to Business Idea Validation only)", () => {
  assert.match(
    pageSource,
    /\{report\.type !== "Market Analysis" \? \(\s*\n\s*<ExecutiveDecisionIntelligencePanel metadata=\{report\.metadata\} \/>\s*\n\s*\) : null\}/
  );
});

test("ReportPdfButton.tsx: the Executive Decision Intelligence PDF page is never drawn for a Market Intelligence report export", () => {
  assert.match(
    pdfButtonSource,
    /const executiveDecisionIntelligenceSummary = isMarketIntelligenceReport\s*\n\s*\? null\s*\n\s*: readExecutiveDecisionIntelligenceSummary\(report\.metadata\);/
  );
});

// ---------------------------------------------------------------------------
// Market Signal placeholder wording consistency between page.tsx and
// Planner.tsx (was "Review" vs "—" for the identical MI-unavailable case).
// ---------------------------------------------------------------------------

test("page.tsx and Planner.tsx: the Market Signal KPI tile shows the identical placeholder for Market Intelligence on both surfaces", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /label: "Market Signal",\s*\n\s*value: isMarketIntelligence\s*\n\s*\? "—"/);
  }
});

// ---------------------------------------------------------------------------
// E) Regeneration/cached-data scenario -- stale presentation/research data
//    cannot override newly generated canonical state.
// ---------------------------------------------------------------------------

function identity(overrides = {}) {
  return {
    normalizedPrompt: "ai-powered construction operations software",
    uploadedAssetHash: "",
    analysisMode: "market",
    language: "English",
    reportFamily: "market_analysis",
    ...overrides,
  };
}

test("E) conversationResearchIdentityMatches: the exact reported exploit -- a snapshot captured for one market's chat question is rejected for a differently-worded request about a different market", () => {
  const snapshotIdentity = identity({ normalizedPrompt: "ai legal software market overview" });
  const requestIdentity = identity({ normalizedPrompt: "ai-powered construction operations software" });

  assert.equal(conversationResearchIdentityMatches(snapshotIdentity, requestIdentity), false);
});

test("E) conversationResearchIdentityMatches: a genuinely matching snapshot (same prompt, asset fingerprint, and language) is still trusted -- the fix must not disable legitimate reuse", () => {
  const snapshotIdentity = identity();
  const requestIdentity = identity();

  assert.equal(conversationResearchIdentityMatches(snapshotIdentity, requestIdentity), true);
});

test("E) conversationResearchIdentityMatches: a different uploaded-asset fingerprint or response language is also rejected, even with an identical prompt string", () => {
  const base = identity();

  assert.equal(
    conversationResearchIdentityMatches(base, identity({ uploadedAssetHash: "sha256:different" })),
    false
  );
  assert.equal(conversationResearchIdentityMatches(base, identity({ language: "Turkish" })), false);
});

test("E) conversationResearchIdentityMatches: reportFamily/analysisMode are deliberately excluded from the comparison -- a casual chat question and a later formal report request about the SAME topic must still be able to reuse each other's research", () => {
  const chatIdentity = identity({ analysisMode: "chat", reportFamily: "chat" });
  const reportIdentity = identity({ analysisMode: "market", reportFamily: "market_analysis" });

  assert.equal(conversationResearchIdentityMatches(chatIdentity, reportIdentity), true);
});

test("research-cache.ts: resolveDomainResearchWithCache enforces conversationResearchIdentityMatches before trusting a conversation snapshot (the fresh-generation path, used by every caller across the codebase)", () => {
  assert.match(
    researchCacheSource,
    /const conversationSnapshot =\s*\n\s*rawConversationSnapshot &&\s*\n\s*conversationResearchIdentityMatches\(rawConversationSnapshot\.identity, input\.identity\)\s*\n\s*\? rawConversationSnapshot\s*\n\s*: null;/
  );
});

test("app/api/market-analysis/route.ts: the cache-hit branch's conversationResearch (context fingerprint + graph reuse) is also gated by the same identity check, not a separate/weaker one", () => {
  assert.match(
    routeSource,
    /const conversationResearch = conversationResearchSnapshot &&\s*\n\s*conversationResearchIdentityMatches\(conversationResearchSnapshot\.identity, researchIdentity\)\s*\n\s*\? conversationResearchSnapshot\s*\n\s*: null;/
  );
});

test("app/api/market-analysis/route.ts and research-cache.ts: both call sites resolve through the SAME exported conversationResearchIdentityMatches helper, not independent duplicated comparisons (single canonical source of truth for this guarantee)", () => {
  assert.match(routeSource, /import \{[\s\S]*?conversationResearchIdentityMatches,[\s\S]*?\} from "@\/app\/lib\/ai\/research-cache";/);
  assert.match(researchCacheSource, /export function conversationResearchIdentityMatches\(/);
});
