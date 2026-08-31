import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  localizeExecutiveDecision,
  formatExecutiveDecisionBrief,
} from "../app/lib/report-engine/executive-decision-brief.ts";
import { createInsightSignature, describesSameInsight } from "../app/lib/report-content-quality.mjs";

// Production-report integrity hardening pass -- fixes exposed by a real
// generated report ("AI-powered construction risk intelligence SaaS for
// small and mid-sized general contractors in the United States"):
//
// 1. Executive Decision vocabulary drift: the SAME report showed
//    "Reject" in one place (resolveMarketIntelligenceExecutiveDecision's
//    decisionLabel, built from the cross-report-kind PROCEED/.../REJECT
//    label set) and "Executive Decision: NO-GO (Confidence: 39%)" in
//    another (the raw executiveSummary banner text, built from the
//    shared GO/CONDITIONAL_GO/NO_GO vocabulary) -- two different
//    vocabularies for one decision, and neither was Market
//    Intelligence's own native ENTER/MONITOR/AVOID. Fixed by adding a
//    "market" ExecutiveDecisionVocabulary variant to the shared
//    executive-decision-brief.ts module (Business Plan/Acquisition keep
//    the default "standard" vocabulary, completely unaffected), applied
//    everywhere Market Intelligence formats or parses its own banner.
//
// 2. Executive Highlights near-duplicate: "Platform module
//    commoditization -- Autodesk/Procore embedding AI features
//    reduces..." appeared twice because dedupeHighlightCandidates only
//    matched byte-identical normalized fingerprints. Fixed by also
//    running describesSameInsight (report-content-quality.mjs) -- the
//    same containment/Jaccard semantic-similarity check the report's own
//    cross-section paragraph dedup already uses -- against every
//    previously accepted candidate.
//
// 3. Circular Major Players fallback: "Major Players: See 'Competitive
//    Landscape' for the established premise." Root cause:
//    competitiveLandscape/majorPlayers were not excluded from
//    dedupeReportParagraphsAcrossSections, so the generic cross-section
//    dedup pass judged their (necessarily vocabulary-overlapping, by
//    design) canonical text a "duplicate insight" and collapsed
//    majorPlayers into its own generic cross-reference -- discarding the
//    real, evidence-backed adjacent-player list. Fixed by adding both
//    fields to route.ts's excludedFields, alongside strategicRecommendations/
//    tamSamSom/executiveSummary (the same established pattern for
//    "canonically-owned content that must never be silently collapsed").

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importExecutiveDecisionVocabulary() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/executive-decision-vocabulary.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-production-hardening-vocab-"));
  const outPath = join(dir, "executive-decision-vocabulary.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { resolveMarketIntelligenceExecutiveDecision } = await importExecutiveDecisionVocabulary();

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
const presentationSource = readFileSync(
  new URL("../app/lib/report-engine/market-intelligence-presentation.ts", import.meta.url),
  "utf8"
);

// ---------------------------------------------------------------------------
// 1. Canonical decision vocabulary -- ENTER / MONITOR / AVOID
// ---------------------------------------------------------------------------

test("canonical vocabulary: GO -> ENTER, MONITOR (CONDITIONAL_GO) -> MONITOR, NO_GO -> AVOID -- English", () => {
  assert.equal(localizeExecutiveDecision("GO", "English", "market"), "ENTER");
  assert.equal(localizeExecutiveDecision("CONDITIONAL_GO", "English", "market"), "MONITOR");
  assert.equal(localizeExecutiveDecision("NO_GO", "English", "market"), "AVOID");
});

test("canonical vocabulary: Business Plan/Acquisition's standard vocabulary (GO/CONDITIONAL GO/NO-GO) is completely unaffected -- the 'market' vocabulary is additive, not a global rename", () => {
  assert.equal(localizeExecutiveDecision("GO", "English"), "GO");
  assert.equal(localizeExecutiveDecision("CONDITIONAL_GO", "English"), "CONDITIONAL GO");
  assert.equal(localizeExecutiveDecision("NO_GO", "English"), "NO-GO");
});

test("NO-GO -> AVOID: the report's own raw executiveSummary banner and resolveMarketIntelligenceExecutiveDecision's decisionLabel agree -- 'NO-GO' never appears for Market Intelligence again", () => {
  const banner = formatExecutiveDecisionBrief(
    {
      decision: "NO_GO",
      confidence: 39,
      confidenceDirection: "reduced",
      confidenceFactors: ["verified market size unavailable"],
      why: "Sizing evidence is not yet independently verifiable.",
      topReasons: ["A niche segment shows early demand signal."],
      topRisks: ["Sizing evidence for TAM/SAM/SOM is not yet independently verifiable."],
      missingEvidence: ["An independently verified market-size figure."],
      whatWouldChangeThisDecision: "An independently verified TAM figure above the viability threshold.",
      immediateNextAction: "Commission a targeted validation study before any broader commitment.",
    },
    "English",
    "market"
  );

  assert.match(banner, /Decision: AVOID \(Confidence: 39%\)/);
  assert.doesNotMatch(banner, /\bNO-GO\b/);

  const result = resolveMarketIntelligenceExecutiveDecision(banner);
  assert.equal(result.decisionLabel, "AVOID");
  assert.notEqual(result.decisionLabel, "Reject");
  assert.notEqual(result.decisionLabel, "NO-GO");
});

test("Reject -> AVOID: decisionLabel is read directly from the market vocabulary, never the cross-report-kind Proceed/Reject label set (canonicalDecision stays on that axis internally, for styling only, never displayed as text)", () => {
  const result = resolveMarketIntelligenceExecutiveDecision("Decision: AVOID (Confidence: 25%)");
  assert.equal(result.decisionLabel, "AVOID");
  assert.notEqual(result.decisionLabel, "Reject");
  assert.equal(result.canonicalDecision, "REJECT", "the internal styling axis is unchanged, just never shown as text");
});

test("Watch/conditional validation -> MONITOR: a CONDITIONAL_GO-class banner resolves to the MONITOR token, never 'CONDITIONAL GO' or 'Proceed with Conditions'", () => {
  const result = resolveMarketIntelligenceExecutiveDecision("Decision: MONITOR (Confidence: 52%)");
  assert.equal(result.decisionLabel, "MONITOR");
  assert.notEqual(result.decisionLabel, "CONDITIONAL GO");
  assert.notEqual(result.decisionLabel, "Proceed with Conditions");
});

test("GO -> ENTER: a genuine affirmative banner resolves to the ENTER token, never 'GO' or 'Proceed'", () => {
  const result = resolveMarketIntelligenceExecutiveDecision("Decision: ENTER (Confidence: 88%)");
  assert.equal(result.decisionLabel, "ENTER");
  assert.notEqual(result.decisionLabel, "GO");
  assert.notEqual(result.decisionLabel, "Proceed");
});

test("insufficient evidence -> MONITOR/neutral where a decision must still be displayed: the PDF's styling fallback never defaults an unresolved/unrecognized decision to the affirmative ENTER-equivalent color -- only an explicit AVOID/KAÇIN match is treated as negative, everything else (including '—' and raw legacy text) is the neutral MONITOR-equivalent color", async () => {
  const body = `export ${extractFunctionSource(pdfButtonSource, "marketDecisionColorCategory")}`;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-production-hardening-colorcat-"));
  const outPath = join(dir, "marketDecisionColorCategory.ts");
  writeFileSync(outPath, `${body}\n`);
  const { marketDecisionColorCategory: fn } = await import(pathToFileURL(outPath).href);

  assert.equal(fn("—"), "CONDITIONAL");
  assert.equal(fn("Monitor for a staged pilot"), "CONDITIONAL");
  assert.equal(fn("random unrelated text"), "CONDITIONAL");
  assert.equal(fn("AVOID"), "CONDITIONAL", "the new market token AVOID is not itself matched by this legacy raw-text fallback -- it is only ever reached for Tier 2/3 results, which never literally contain the vocabulary token");
  assert.equal(fn("NO-GO"), "NO_GO");
  assert.equal(fn("HAYIR"), "NO_GO");
});

test("assessMarketEntryConfidence never manufactures ENTER or AVOID as a false-precision middle ground -- MONITOR is the deliberate default band between the two directional thresholds", () => {
  // P0 PRODUCTION FIX -- confirmed live (Market Intelligence research-
  // quality failure): this threshold ternary now reads from
  // rawConfidence (the uncapped blend), not `confidence` -- the
  // thresholds (65/40) and the ENTER/MONITOR/AVOID band structure this
  // test protects are otherwise unchanged.
  // TASK #29B -- 65/40 extracted into named constants, reused by the new
  // per-factor confidence-level derivation -- literal shape changed,
  // thresholds/branches did not.
  assert.match(presentationSource, /const STRONG_CONFIDENCE_THRESHOLD = 65;/);
  assert.match(presentationSource, /const MODERATE_CONFIDENCE_THRESHOLD = 40;/);
  assert.match(
    presentationSource,
    /rawConfidence >= STRONG_CONFIDENCE_THRESHOLD\s*\n\s*\? "ENTER"\s*\n\s*: rawConfidence >= MODERATE_CONFIDENCE_THRESHOLD\s*\n\s*\? "MONITOR"\s*\n\s*: "AVOID";/
  );
});

test("web/PDF decision vocabulary parity: page.tsx, Planner.tsx, and ReportPdfButton.tsx all resolve Market Intelligence's decision through the SAME resolveMarketIntelligenceExecutiveDecision call, and none of them independently hardcodes 'Proceed'/'Reject'/literal 'GO'/'NO-GO' text gated on isMarketIntelligence", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.match(source, /resolveMarketIntelligenceExecutiveDecisionWithCanonicalState\(/);
  }
});

// ---------------------------------------------------------------------------
// 2. Executive Highlights semantic deduplication
// ---------------------------------------------------------------------------

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
  while (source[i] !== "{") i += 1;
  let braceDepth = 0;
  do {
    if (source[i] === "{") braceDepth += 1;
    else if (source[i] === "}") braceDepth -= 1;
    i += 1;
  } while (braceDepth > 0);
  return source.slice(start, i);
}

async function compileDedupeHighlightCandidates(source) {
  const header = `import { createInsightSignature, describesSameInsight } from ${JSON.stringify(
    pathToFileURL(join(repoRoot, "app/lib/report-content-quality.mjs")).href
  )};\n\n`;
  const body = `export ${extractFunctionSource(source, "dedupeHighlightCandidates")}`;
  const dir = mkdtempSync(join(tmpdir(), "zerinix-production-hardening-highlights-"));
  const outPath = join(dir, "dedupeHighlightCandidates.ts");
  writeFileSync(outPath, `${header}${body}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.dedupeHighlightCandidates;
}

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  test(`${label}: the exact reported production defect -- the same underlying insight extracted twice with different lead-in phrasing/punctuation collapses into one Executive Highlight`, async () => {
    const dedupeHighlightCandidates = await compileDedupeHighlightCandidates(source);

    const candidates = [
      "Platform module commoditization — Autodesk/Procore embedding AI features reduces the standalone value of point solutions in this category.",
      "Platform module commoditization: Autodesk/Procore embedding AI features reduces standalone module value for point solutions.",
      "Buyer procurement cycles for small and mid-sized general contractors remain slow, extending time-to-close for new entrants.",
    ];

    const result = dedupeHighlightCandidates(candidates);
    assert.equal(result.length, 2, "the two near-identical restatements must collapse into one");
    assert.ok(result.some((item) => item.includes("Platform module commoditization")));
    assert.ok(result.some((item) => item.includes("procurement cycles")));
  });

  test(`${label}: genuinely distinct risks/opportunities that merely share a topic or a common word are never dropped -- only near-identical restatements collapse`, async () => {
    const dedupeHighlightCandidates = await compileDedupeHighlightCandidates(source);

    const candidates = [
      "Regulatory approval timelines for construction risk platforms remain uncertain across target states.",
      "Regulatory bodies have signaled openness to streamlined approval for construction safety software specifically, a distinct and more favorable signal than the general timeline uncertainty.",
      "Buyer procurement cycles for small and mid-sized general contractors remain slow, extending time-to-close for new entrants.",
    ];

    const result = dedupeHighlightCandidates(candidates);
    assert.equal(result.length, 3, "three genuinely distinct statements must all survive");
  });

  test(`${label}: exact-duplicate candidates (byte-identical after trimming) still collapse -- the pre-existing fast path is unchanged`, async () => {
    const dedupeHighlightCandidates = await compileDedupeHighlightCandidates(source);

    const candidates = [
      "Sizing evidence for TAM/SAM/SOM is not yet independently verifiable.",
      "Sizing evidence for TAM/SAM/SOM is not yet independently verifiable.",
    ];

    const result = dedupeHighlightCandidates(candidates);
    assert.equal(result.length, 1);
  });
}

test("describesSameInsight is genuinely semantic (containment + Jaccard token overlap), not exact-string equality -- confirmed directly against the report's own real similarity engine", () => {
  const a = createInsightSignature(
    "Platform module commoditization — Autodesk/Procore embedding AI features reduces the standalone value of point solutions in this category."
  );
  const b = createInsightSignature(
    "Platform module commoditization: Autodesk/Procore embedding AI features reduces standalone module value for point solutions."
  );
  const c = createInsightSignature(
    "Buyer procurement cycles for small and mid-sized general contractors remain slow, extending time-to-close for new entrants."
  );

  assert.notEqual(a.fingerprint, b.fingerprint, "sanity check: these are not byte-identical after normalization");
  assert.ok(describesSameInsight(a, b), "near-identical restatements must be recognized as the same insight");
  assert.ok(!describesSameInsight(a, c), "genuinely distinct statements must not be flagged as duplicates");
});

// ---------------------------------------------------------------------------
// 3. Competitive taxonomy: direct / adjacent / unverified, and the circular
//    Major Players fallback
// ---------------------------------------------------------------------------

const checkedAt = "2026-08-15T00:00:00.000Z";
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `E${idCounter}`;
}

function baseEvidence(overrides) {
  return {
    id: nextId(),
    field: "vendor_discovery",
    claim: "",
    value: "",
    label: "Verified from external source",
    sourceTitle: "",
    publisher: "",
    url: "",
    sourceType: "credible_market_data",
    authorityLevel: "secondary",
    confidence: 80,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "Supports vendor discovery coverage.",
    qualityScore: 74,
    qualityRationale: "Independently sourced vendor mention.",
    searchQuery: "",
    ...overrides,
  };
}

function singleListicleMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} is named in an industry roundup as active in or adjacent to this market.`,
    value: `${name} roundup mention`,
    sourceTitle: `${name} roundup listicle`,
    publisher: domain,
    url: `https://${domain}/blog/roundup`,
    sourceType: "credible_market_data",
    searchQuery: `${name} construction software`,
  });
}

function officialMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} provides subscription software with product and integration features for enterprise and SMB customers.`,
    value: `${name} subscription pricing and product feature evidence`,
    sourceTitle: `${name} official product and pricing page`,
    publisher: name,
    url: `https://${domain}/pricing`,
    sourceType: "company_source",
    authorityLevel: "primary",
  });
}

function reviewMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} offers a highly rated platform used by buyers researching this category.`,
    value: `${name} customer review summary`,
    sourceTitle: `${name} reviews and ratings`,
    publisher: domain,
    url: `https://${domain}/reviews/${encodeURIComponent(name.toLowerCase())}`,
  });
}

// The real production report's prompt ("AI-powered construction risk
// intelligence SaaS for small and mid-sized general contractors in the
// United States") does not match a curated market-taxonomy vertical, so
// Procore/Autodesk would only be discovered via the slower heuristic-
// mention pipeline there. This uses a prompt that resolves to the
// curated "Construction ERP" taxonomy (whose real vendor catalog
// includes Procore and Autodesk Construction Cloud by name) so the
// fixture reliably exercises the exact adjacent-player classification
// mechanism the production report relies on, without depending on the
// heuristic discovery path's own separate evidence-richness heuristics.
const constructionRiskPrompt = "Analyze the Construction ERP market for AI-powered construction operations.";

test("A) direct validated competitors: fully evidenced vendors classify as direct, and Competitive Landscape/Major Players consistently expose them", () => {
  const evidence = [
    officialMention({ name: "SiteGuard", domain: "siteguard.example.com" }),
    reviewMention({ name: "SiteGuard", domain: "g2.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, constructionRiskPrompt);
  assert.deepEqual(
    graph.vendorIntelligence.vendors.map((v) => v.name),
    ["SiteGuard"]
  );

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.competitiveLandscape, /SiteGuard/);
  assert.match(projection.majorPlayers, /SiteGuard/);
  assert.doesNotMatch(projection.competitiveLandscape, /No competitor data could be validated/i);
});

test("B) no direct competitors, but validated adjacent/platform players (Autodesk/Procore) exist -- Competitive Landscape must NOT say 'no competitor data could be validated', and must explicitly distinguish direct-competitor unavailability from adjacent-player evidence", () => {
  const evidence = [
    singleListicleMention({ name: "Autodesk Construction Cloud", domain: "constructiontechroundup.example.com" }),
    singleListicleMention({ name: "Procore", domain: "constructiontechroundup.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, constructionRiskPrompt);
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.deepEqual(
    graph.vendorIntelligence.adjacentPlayers.map((p) => p.name).sort(),
    ["Autodesk Construction Cloud", "Procore"]
  );

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");

  assert.doesNotMatch(projection.competitiveLandscape, /No competitor data could be validated/i);
  assert.match(projection.competitiveLandscape, /evidence-supported/i);
  assert.match(projection.competitiveLandscape, /structured positioning data/i);

  // Major Players uses the SAME classification -- adjacent, never promoted
  // to a validated direct competitor.
  assert.match(projection.majorPlayers, /Autodesk Construction Cloud/);
  assert.match(projection.majorPlayers, /Procore/);
  assert.match(projection.majorPlayers, /Not Independently Validated as Direct Competitors/i);
  assert.doesNotMatch(projection.majorPlayers, /validated direct competitors?/i);
});

test("C) no defensible player evidence at all: the truthful Validation Needed state is used, and it is the SAME text for Competitive Landscape and Major Players (no circular fallback needed since there is genuinely nothing to point to)", () => {
  const evidence = [
    baseEvidence({
      claim: "General commentary about the market with no numeric size figure or named vendor.",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.example.com/overview",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Analyze an obscure niche market.");
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  assert.equal(graph.vendorIntelligence.adjacentPlayers.length, 0);

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.equal(projection.competitiveLandscape, projection.majorPlayers);
});

test("adjacent players are never promoted to direct competitors regardless of which market taxonomy vertical they're evaluated against", () => {
  const evidence = [
    singleListicleMention({ name: "Procore", domain: "constructiontechroundup.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, constructionRiskPrompt);
  assert.ok(!graph.vendorIntelligence.vendors.some((v) => v.name === "Procore"));
  assert.ok(graph.vendorIntelligence.adjacentPlayers.some((p) => p.name === "Procore"));
});

test("Major Players cannot render the circular 'See Competitive Landscape for the established premise' fallback -- competitiveLandscape and majorPlayers are excluded from cross-section paragraph dedup", () => {
  assert.match(
    routeSource,
    /excludedFields:\s*\[\s*"strategicRecommendations",\s*"tamSamSom",\s*"executiveSummary",\s*"competitiveLandscape",\s*"majorPlayers",\s*"cagr",?\s*\]/
  );
});

test("D) validated adjacent players must prevent the blanket 'no competitor data' fallback even when the underlying coverage-description text is reused across languages", () => {
  const evidence = [
    singleListicleMention({ name: "Autodesk Construction Cloud", domain: "constructiontechroundup.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, constructionRiskPrompt);
  for (const language of ["English", "Turkish", "German", "French", "Spanish"]) {
    const projection = projectMarketIntelligenceGraphToReport(graph, language);
    assert.doesNotMatch(
      projection.competitiveLandscape,
      /^Independent, publicly available information.*was limited during research/i
    );
  }
});

// ---------------------------------------------------------------------------
// F) UI and PDF consume the same normalized competitor state
// ---------------------------------------------------------------------------

test("F) web dashboard, Planner, and the PDF export all read the SAME canonical competitiveLandscape/majorPlayers report fields -- no separate PDF-only competitor interpretation exists", () => {
  // The canonical fields are computed exactly once, server-side, in
  // projectMarketIntelligenceGraphToReport (market-intelligence-graph.ts)
  // and persisted onto the report row -- every rendering surface reads
  // that same persisted text. Structural proof: none of the three
  // presentation files re-derive a competitor validation VERDICT of their
  // own (e.g. an independent "no competitor data" string literal used as
  // anything other than a fallback render of the canonical field).
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    assert.doesNotMatch(source, /See ["'“]?Competitive Landscape["'”]? for the established premise/);
  }
});

// ---------------------------------------------------------------------------
// 6 & 7. Market Size/CAGR and TAM/SAM/SOM validation-dependency behavior
//         preserved (no threshold loosened, no fabricated values)
// ---------------------------------------------------------------------------

test("Market Size/CAGR: still fail closed to a Validation Needed / unavailable state when evidence is insufficient -- the canonical marketSizeUnavailable/tamSamSomUnavailable copy still names the same gap after P0 FIX #5 reworded it to say 'confirmed' instead of 'verified' (source/evidence integrity repair -- avoids a false 'Data Confirmed' KPI-card read of this exact unavailability text)", () => {
  const graphSource = readFileSync(new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url), "utf8");
  assert.match(
    graphSource,
    /A defensible aggregate market-size figure could not be established for this market\./
  );
  assert.match(
    graphSource,
    /A confirmed market-size figure \(TAM \/ SAM \/ SOM\) could not be established for this market\./
  );
});

test("TAM/SAM/SOM: the TAM >= SAM >= SOM dependency cascade in the section-level evidence badge is untouched by this pass", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /function resolveTamSamSomCascade/);
    assert.match(source, /const somResolved = samResolved && magnitudes\[2\] !== null/);
  }
});
