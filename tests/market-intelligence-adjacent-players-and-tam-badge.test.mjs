import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";

// Cross-section semantic consistency fixes:
//
// 1. Competitive Landscape vs. Major Players contradiction -- Competitive
//    Landscape correctly said "no competitor data validated" while Major
//    Players, immediately below it, listed real companies as if they were
//    evidence-supported DIRECT competitors. Root cause: the vendor pipeline
//    was a binary gate (validateVendorCandidate && assessMarketRelevance) --
//    a candidate either became a fully validated `vendor` (eligible for
//    both the competitor table and Major Players) or was discarded
//    entirely. When zero candidates cleared the strict multi-source
//    direct-competitor bar, market-intelligence-graph.ts's projection used
//    to force Major Players to the exact same "no data" notice, discarding
//    any real evidence about companies genuinely relevant to the market
//    that simply had thinner corroboration. Fixed by adding a second,
//    honestly-labeled tier (vendor-intelligence.ts's
//    VendorIntelligenceGraph.adjacentPlayers) captured from the SAME
//    discovery pass and evidence (never a new, lower evidence bar invented
//    after the fact, and never eligible for the competitor table or
//    eligibleForMajorPlayers) -- Competitive Landscape still correctly
//    stays "Validation Needed", but Major Players now lists these adjacent/
//    relevant players under an explicit "not independently validated as a
//    direct competitor" label instead of either claiming direct-competitor
//    status for them or silently dropping real evidence.
//
// 2. TAM/SAM/SOM section badge said "Data Confirmed" while TAM/SAM/SOM
//    were all unresolved. Root cause: the section-level evidence badge
//    (getDashboardSectionEvidence/getSectionEvidenceLevel) used a
//    completely independent, naive keyword scan from the per-layer bar
//    visual's own correct TAM>=SAM>=SOM cascade -- when no "Label: value"
//    line matched, its "value" input fell back to the section's own
//    static title (always truthy), and the honest "insufficient evidence"
//    notice copy itself contains the word "verified" ("A verified
//    market-size figure ... could not be established"), which the naive
//    scanner read as a positive signal. Fixed by extracting the bar
//    visual's own resolved/nested cascade into a single shared function
//    (resolveTamSamSomCascade / getTamSamSomSectionEvidence) that both the
//    visual and the section badge now call, so they can never diverge
//    again -- a section only reads "Data Confirmed" when TAM, SAM, AND SOM
//    are all resolved and nested, and never when the stack is fully
//    resolved but only ever reached an [Estimated]/Planning Estimate
//    figure (that is a planning estimate, not verified data).

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");

// Balanced-bracket function extractor (handles multi-line typed parameter
// lists whose own sibling braces would fool a naive lazy regex) -- same
// technique established in market-intelligence-tam-sam-som-dedup.test.mjs.
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

function extractConstSource(source, constName) {
  const match = source.match(new RegExp(`const ${constName} =[\\s\\S]*?;\\n`));
  assert.ok(match, `${constName} not found`);
  return match[0];
}

// Bundles the TAM/SAM/SOM evidence cascade's full, real dependency chain
// (never a reimplementation) into one temp module and imports it. page.tsx's
// chain is fully self-contained; Planner.tsx's extractMarketSizeValue needs
// the real normalizePdfText from pdf-normalization.mjs, imported by absolute
// path exactly the way the established @/-alias-rewriting test pattern does
// for other files' external imports.
async function compileTamSamSomEvidenceModule(source, { external } = {}) {
  const pieces = [
    extractConstSource(source, "tamSamSomBarLabels"),
    external === "planner"
      ? extractFunctionSource(source, "escapeRegExp")
      : "",
    external === "planner"
      ? extractFunctionSource(source, "isMarketSizeValueMeaningful")
      : "",
    external === "planner"
      ? extractFunctionSource(source, "compactPdfMetricValue")
      : "",
    external === "planner"
      ? extractFunctionSource(source, "extractMetricValue")
      : "",
    external === "planner"
      ? extractFunctionSource(source, "extractMarketSizeValue")
      : [
          extractFunctionSource(source, "extractMetricValue"),
          extractFunctionSource(source, "extractMetricValueFromAliases"),
          extractFunctionSource(source, "extractMarketSizeCardValue"),
        ].join("\n\n"),
    external === "planner"
      ? extractFunctionSource(source, "parseMarketSizeMagnitude")
      : extractFunctionSource(source, "parseMonetaryMagnitude"),
    extractFunctionSource(source, "extractMarketSizeAssumption"),
    extractFunctionSource(source, "isMarketSizeEstimated"),
    extractFunctionSource(source, "resolveTamSamSomCascade"),
    `export ${extractFunctionSource(source, "getTamSamSomSectionEvidence")}`,
  ].join("\n\n");

  const header =
    external === "planner"
      ? `import { normalizePdfText } from ${JSON.stringify(
          pathToFileURL(join(process.cwd(), "app/lib/pdf-normalization.mjs")).href
        )};\nimport { formatMetricCardValue } from ${JSON.stringify(
          pathToFileURL(join(process.cwd(), "components/planner/report-utils.ts")).href
        )};\n\n`
      : "";

  const dir = mkdtempSync(join(tmpdir(), "zerinix-tam-badge-fn-"));
  const outPath = join(dir, "tamSamSomEvidence.ts");
  writeFileSync(outPath, `${header}${pieces}\n`);
  const mod = await import(pathToFileURL(outPath).href);
  return {
    getTamSamSomSectionEvidence: mod.getTamSamSomSectionEvidence,
  };
}

const checkedAt = "2026-08-15T00:00:00.000Z";

// ---------------------------------------------------------------------------
// A) No validated direct competitors + supported adjacent industry players
// ---------------------------------------------------------------------------

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

// A single low-quality mention -- one evidence item, one domain, no
// official page -- exactly the shape validateVendorCandidate's own
// documented "single low-quality mention is not sufficient" reason
// describes. Named in the ticket's own reported companies (real
// Construction ERP taxonomy catalog vendors), reused here as the reported
// live scenario's most direct reproduction.
function singleListicleMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} is named in an industry roundup as active in AI construction operations.`,
    value: `${name} roundup mention`,
    sourceTitle: `${name} roundup listicle`,
    publisher: domain,
    url: `https://${domain}/blog/roundup`,
    sourceType: "credible_market_data",
    searchQuery: `${name} construction software`,
  });
}

test("A) no validated direct competitors + supported adjacent industry players: Competitive Landscape stays Validation Needed, Major Players honestly lists them as adjacent/relevant players, never as validated direct competitors -- the exact reported Procore/Autodesk contradiction", () => {
  const prompt = "Analyze the Construction ERP market for AI-powered construction operations.";
  const evidence = [
    singleListicleMention({ name: "Procore", domain: "constructiontechroundup.example.com" }),
    singleListicleMention({ name: "Autodesk Construction Cloud", domain: "constructiontechroundup.example.com" }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);

  // No direct competitor cleared the stricter validation bar.
  assert.equal(graph.vendorIntelligence.vendors.length, 0);
  // But both companies are captured as evidence-supported adjacent players.
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((player) => player.name).sort();
  assert.deepEqual(adjacentNames, ["Autodesk Construction Cloud", "Procore"]);

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");

  // Competitive Landscape correctly remains "Validation Needed" -- no
  // fabricated direct-competitor claim -- and, since adjacent players DO
  // exist, explicitly says so rather than the flat "no competitor data"
  // phrasing (further hardened in a later pass: describeCompetitiveCoverage
  // now distinguishes "nothing at all" from "no direct, but adjacent
  // players evidenced" -- and later still, reworded to frame the actual
  // gap as missing STRUCTURED POSITIONING data rather than unvalidated
  // competitor identity, since the incumbents themselves ARE
  // evidence-supported).
  assert.match(projection.competitiveLandscape, /evidence-supported/i);
  assert.match(projection.competitiveLandscape, /structured positioning data/i);
  assert.doesNotMatch(projection.competitiveLandscape, /Procore/);
  assert.doesNotMatch(projection.competitiveLandscape, /Autodesk/);

  // Major Players lists the real, evidence-named companies -- never
  // discarded -- but explicitly, honestly labeled as NOT validated direct
  // competitors.
  assert.match(projection.majorPlayers, /Procore/);
  assert.match(projection.majorPlayers, /Autodesk Construction Cloud/);
  assert.match(projection.majorPlayers, /Not Independently Validated as Direct Competitors/i);
  assert.match(projection.majorPlayers, /not independently validated as a direct competitor/i);

  // No semantic contradiction: Major Players never claims these are
  // validated/confirmed direct competitors.
  assert.doesNotMatch(projection.majorPlayers, /evidence-supported major players/i);
  assert.doesNotMatch(projection.majorPlayers, /\bvalidated competitors?\b/i);
});

test("A) adjacent players never upgrade to direct-competitor status: excluded non-vendor roles (implementation partners) and institutional entities never appear as adjacent players either", () => {
  const prompt = "Analyze the Construction ERP market.";
  const evidence = [
    baseEvidence({
      claim: "Ironframe Implementation Partners offers implementation partner services and systems integrator consulting for enterprise rollouts.",
      value: "Ironframe Implementation Partners implementation partner services",
      sourceTitle: "Ironframe Implementation Partners directory listing",
      publisher: "partnerdirectory.example.com",
      url: "https://partnerdirectory.example.com/directory/ironframe",
    }),
    baseEvidence({
      claim: "OSHA publishes official statistics relevant to this market's demand and structure.",
      value: "OSHA official statistics",
      sourceTitle: "OSHA official statistics",
      publisher: "OSHA",
      url: "https://osha.gov/data",
      sourceType: "official_statistics",
      authorityLevel: "primary",
    }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((player) => player.name);

  assert.ok(!adjacentNames.some((name) => name.includes("Ironframe")), "implementation partner must never appear as an adjacent player");
  assert.ok(!adjacentNames.some((name) => name.includes("OSHA")), "government institution must never appear as an adjacent player");
});

// ---------------------------------------------------------------------------
// C) Fully validated direct competitors -- Competitive Landscape and Major
//    Players stay mutually consistent, and no vendor ever double-counts as
//    an adjacent player.
// ---------------------------------------------------------------------------

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

test("C) fully validated direct competitors: Competitive Landscape and Major Players consistently expose the same validated competitor set, and a validated vendor never also appears as an adjacent player", () => {
  const prompt = "Analyze the Construction ERP market.";
  const evidence = [
    officialMention({ name: "SiteLedger", domain: "siteledger.example.com" }),
    reviewMention({ name: "SiteLedger", domain: "g2.example.com" }),
    officialMention({ name: "CrewStack", domain: "crewstack.example.com" }),
    reviewMention({ name: "CrewStack", domain: "capterra.example.com" }),
    // A thin, single-source mention alongside the two validated vendors --
    // must land in adjacentPlayers, never in vendors, and never silently
    // dropped now that real direct competitors exist too.
    singleListicleMention({ name: "Procore", domain: "constructiontechroundup.example.com" }),
  ];

  const graph = buildMarketIntelligenceGraph({ evidence }, prompt);
  const vendorNames = graph.vendorIntelligence.vendors.map((vendor) => vendor.name).sort();
  const adjacentNames = graph.vendorIntelligence.adjacentPlayers.map((player) => player.name);

  assert.deepEqual(vendorNames, ["CrewStack", "SiteLedger"]);
  assert.deepEqual(adjacentNames, ["Procore"]);
  // Mutual exclusivity: no name appears in both tiers.
  assert.ok(!adjacentNames.some((name) => vendorNames.includes(name)));

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");

  assert.match(projection.competitiveLandscape, /SiteLedger/);
  assert.match(projection.competitiveLandscape, /CrewStack/);
  assert.match(projection.majorPlayers, /SiteLedger/);
  assert.match(projection.majorPlayers, /CrewStack/);
  // The validated-competitor branch renders the real table/bullet list --
  // never the adjacent-players fallback copy.
  assert.doesNotMatch(projection.majorPlayers, /Not Independently Validated as Direct Competitors/i);
});

// ---------------------------------------------------------------------------
// B) & D) TAM/SAM/SOM section-level evidence badge
// ---------------------------------------------------------------------------

// The real, production tamSamSomUnavailable English copy
// (market-intelligence-graph.ts) -- deliberately reused verbatim because it
// is the exact text that triggered the reported bug: it contains the word
// "verified" in a NEGATIVE sense ("A verified ... figure could not be
// established"), which the old naive keyword scan read as a positive
// "Data Confirmed" signal.
const tamSamSomUnavailableCopy =
  "A verified market-size figure (TAM / SAM / SOM) could not be established for this market. No comparable local, regional, or global benchmark was available to build a labeled estimate from, and the available data on buyer population and pricing was not sufficient together to construct one either. This gap reflects a lack of published data for this specific scope, not the size of the opportunity. The number of vendors identified was not used on its own to fabricate a market-size figure.";

const fullyVerifiedTamSamSomCopy = [
  "TAM: $4.2 billion based on independently verified market statistics.",
  "SAM: $1.8 billion, the segment reachable via current sales channels.",
  "SOM: $450 million realistically obtainable in year one.",
].join("\n");

const fullyEstimatedTamSamSomCopy = [
  "TAM [Estimated]: $4.2 billion based on a regional benchmark scaling assumption.",
  "SAM [Estimated]: $1.8 billion.",
  "SOM [Estimated]: $450 million.",
].join("\n");

const tamUnresolvedSamPendingCopy = [
  "TAM: Validation Needed -- no defensible aggregate figure could be established.",
  "SAM: $1.8 billion.",
  "SOM: $450 million.",
].join("\n");

for (const [label, source, external] of [
  ["page.tsx", pageSource, undefined],
  ["Planner.tsx", plannerSource, "planner"],
]) {
  test(`${label}: B) TAM unavailable -> the section-level evidence badge is validationRequired, never verified/"Data Confirmed", even though the honest notice text itself contains the word "verified"`, async () => {
    const { getTamSamSomSectionEvidence } = await compileTamSamSomEvidenceModule(source, { external });

    assert.equal(getTamSamSomSectionEvidence(tamSamSomUnavailableCopy), "validationRequired");
  });

  test(`${label}: B) TAM unresolved with SAM/SOM still present in the raw text -- the whole section stays validationRequired (SAM/SOM never independently confirm the section while their parent, TAM, is unresolved)`, async () => {
    const { getTamSamSomSectionEvidence } = await compileTamSamSomEvidenceModule(source, { external });

    assert.equal(getTamSamSomSectionEvidence(tamUnresolvedSamPendingCopy), "validationRequired");
  });

  test(`${label}: D) fully validated, correctly nested TAM/SAM/SOM (no [Estimated] tag anywhere) -- the section-level badge is verified ("Data Confirmed"), matching genuine validation`, async () => {
    const { getTamSamSomSectionEvidence } = await compileTamSamSomEvidenceModule(source, { external });

    assert.equal(getTamSamSomSectionEvidence(fullyVerifiedTamSamSomCopy), "verified");
  });

  test(`${label}: a fully resolved and correctly nested TAM/SAM/SOM stack that is only ever an [Estimated] planning figure must NOT read as "Data Confirmed" -- it is a planning estimate, not verified data`, async () => {
    const { getTamSamSomSectionEvidence } = await compileTamSamSomEvidenceModule(source, { external });

    assert.equal(getTamSamSomSectionEvidence(fullyEstimatedTamSamSomCopy), "benchmarkDerived");
  });

  test(`${label}: reproduces the exact root cause -- inferEvidenceLevel's naive keyword scan against the real unavailable-notice text (the OLD derivation) would have returned "verified" purely because the text contains that word, proving the bug and why the new cascade-based derivation was required`, () => {
    // Minimal reproduction of the old, naive inferEvidenceLevel logic this
    // section used to route through (report-evidence.ts) -- not a
    // reimplementation of the fix, just documentation of the exact defect
    // shape being guarded against.
    const evidenceContext = `TAM / SAM / SOM\nTAM / SAM / SOM\n${tamSamSomUnavailableCopy}`;
    const wouldHaveBeenVerified = /\b(verified|actual|audited|invoice|bookkeeping|accounting|bank|stripe)\b/i.test(
      evidenceContext
    );
    assert.equal(wouldHaveBeenVerified, true, "sanity check: the real unavailable-notice text does contain a false-positive trigger word");
  });
}

test("page.tsx and Planner.tsx: getDashboardSectionEvidence/getSectionEvidenceLevel route TAM/SAM/SOM through the new canonical getTamSamSomSectionEvidence, and the per-layer bar visual now shares the exact same resolveTamSamSomCascade -- the badge and the visual can never diverge again", () => {
  assert.match(pageSource, /if \(field\.includes\("tam"\) \|\| title\.includes\("tam \/ sam \/ som"\)\) \{\s*\n\s*return getTamSamSomSectionEvidence\(section\.content\);/);
  assert.match(plannerSource, /if \(section\.field === "tamSamSom"\) \{\s*\n\s*return getTamSamSomSectionEvidence\(section\.content\);/);

  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const \{ values, magnitudes, tamResolved, samResolved, somResolved \} = resolveTamSamSomCascade\(content\);|const \{ magnitudes, tamResolved, samResolved, somResolved \} = resolveTamSamSomCascade\(section\.content\);/);
  }
});

test("page.tsx and Planner.tsx: the unrelated financial/financialDashboard/unitEconomics section badges keep their prior Gross Margin-based derivation unchanged (regression guard -- this fix is scoped to TAM/SAM/SOM only)", () => {
  assert.match(
    pageSource,
    /if \(field\.includes\("financial"\) \|\| title\.includes\("financial"\) \|\| title\.includes\("finansal"\)\) \{\s*\n\s*return getDashboardMetricEvidence\(\s*\n\s*section\.title,\s*\n\s*extractMetricValue\(section\.content, "Gross Margin"\) \|\| section\.title,/
  );
  assert.match(
    plannerSource,
    /if \(section\.field === "financialDashboard" \|\| section\.field === "unitEconomics"\) \{\s*\n\s*return inferEvidenceLevel\(\{\s*\n\s*label: section\.title,\s*\n\s*value: extractMetricValue\(section\.content, "Gross Margin"\) \|\| section\.title,/
  );
});
