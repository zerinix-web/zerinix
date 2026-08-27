import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { getMarketTaxonomyProfile } from "../app/lib/ai/market-taxonomy.ts";
import {
  buildMarketResearchTasks,
} from "../app/lib/ai/market-research-planner.ts";
import { createDynamicReportPlanFallback } from "../app/lib/ai/dynamic-report-plan.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";
import {
  classifyOrganizationEntity,
  isAuthoritativeMarketEvidenceSource,
} from "../app/lib/ai/commercial-vendor-intelligence.ts";
import { classifyMarketEvidenceSource } from "../app/lib/ai/market-research-coverage.ts";
import {
  extractVendorCandidateMentions,
} from "../app/lib/ai/vendor-discovery.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  getSectionTakeaway,
  stripLeadingTakeawaySentence,
} from "../app/lib/report-presentation.ts";
import { assessMarketEntryConfidence } from "../app/lib/report-engine/market-intelligence-presentation.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// P0 PRODUCTION FIX -- targeted root-cause investigation and fix for the
// remaining Market Intelligence research-quality failures observed in a
// real production report for a mature U.S. commercial real estate
// services market (a market with abundant published market-size/CAGR
// data and well-known major companies -- CBRE, JLL, Cushman &
// Wakefield, Colliers, Newmark -- so these failures were confirmed to
// be pipeline defects, never genuine absence of evidence).
//
// ROOT CAUSES (confirmed via direct code execution, not guessed):
//
// 1. MARKET SIZE / CAGR / TAM-SAM-SOM:
//    a. extractDynamicProductCategory (market-taxonomy.ts) treated the
//       period inside "U.S."/"U.K."/etc. as a clause boundary --
//       verified by execution to produce productCategory = "a on the
//       mature U" for the exact reported prompt shape, poisoning every
//       downstream query (vendor discovery, market size, competitors,
//       benchmarks) with garbage. Fixed by protecting known
//       abbreviations' periods before matching/splitting, mirroring
//       report-presentation.ts's existing protectSentenceAbbreviations
//       technique for the identical class of bug.
//    b. joinQuery (market-research-planner.ts) sliced the WHOLE joined
//       query string to 220 chars from the front -- verified by
//       execution to silently drop the literal "market size CAGR
//       methodology geography year analyst report" suffix (the ONLY
//       part of the query that actually asks for market-sizing data)
//       whenever the category/context prefix was long, even with a
//       clean category name. Fixed by always preserving the final,
//       most-important part of the query and truncating only the
//       earlier variable-length parts.
//    c. scoreResearchEvidence (domain-research.ts) and
//       classifyMarketEvidenceSource (market-research-coverage.ts) had
//       no recognition of named market-research publishers (IBISWorld,
//       Grand View Research, Statista, ...) -- a genuine citation from
//       one of these scored LOWER authority than a random blog, purely
//       because neither classifier's domain-suffix/keyword checks knew
//       about them. Fixed via a new shared
//       isAuthoritativeMarketEvidenceSource (reusing the market-
//       research-publisher recognition classifyOrganizationEntity
//       already has, for a different purpose), wired into both.
//
// 2. COMPETITIVE LANDSCAPE: vendor-discovery.ts's mentionPatterns
//    required a SaaS-marketing-copy verb ("offers"/"provides") directly
//    adjacent to a candidate name -- real evidence about market leaders
//    in a mature/services market reads as enumeration ("the leading
//    firms are CBRE, JLL, ...") or ranking/revenue framing ("CBRE
//    reported revenue of $35.8B", "JLL ranked #2"), which no pattern
//    could match, so real companies were never even extracted as
//    candidates. Fixed with new, industry-agnostic enumeration and
//    ranking/revenue patterns. Separately, classifyOrganizationEntity's
//    commercial_vendor bar required SaaS-site URL conventions
//    (/products, /pricing) a services company's site never has --
//    broadened with industry-agnostic about/investor-relations path
//    recognition and ticker-symbol adjacency, WITHOUT weakening the
//    existing customer/publisher exclusion (verified against the
//    existing DSV real-press-release regression fixture).
//
// 3. TAM/SAM/SOM: downstream of (1) -- once real market-size/CAGR
//    evidence can actually be found and correctly scored, buildPlanningEstimate's
//    existing bottom-up/adjacent-proxy cascade (already correct, not
//    modified) has real evidence to work with.
//
// 4. DUPLICATE CONTENT: page.tsx's Key-Takeaway card
//    (extractRealBulletLines) never received the earlier PDF fix
//    (stripLeadingTakeawaySentence, wired only into ReportPdfButton.tsx)
//    -- a numbered/bulleted first item was promoted to the Key Takeaway
//    AND still appeared as the first bullet underneath it. Fixed by
//    feeding extractRealBulletLines the takeaway-stripped content
//    (extractSectionMainExplanation's own, already-correct index-based
//    skip logic is left completely untouched, still fed the original
//    content, since pre-stripping it would double-skip a sentence).
//    Separately, stripLeadingTakeawaySentence itself had a markdown-
//    bold asymmetry (getSectionTakeaway strips "**" but the candidate-
//    side normalization did not), causing false-negative duplicate
//    detection on bold-led sentences -- fixed by stripping markdown on
//    both sides before comparing.
//
// 5. CONFIDENCE INTEGRITY: assessMarketEntryConfidence already gated
//    the DECISION LABEL on decision-critical evidence gaps, but by
//    deliberate prior design left the CONFIDENCE NUMBER itself
//    untouched -- a real report read "MONITOR: 63%" while Market Size,
//    CAGR, TAM/SAM/SOM, and the competitor table were ALL "Validation
//    Needed". Fixed by capping the number (not reweighting the blend
//    formula, which remains byte-identical) specifically in the two
//    narrow states where decision-critical evidence is unresolved,
//    computed strictly AFTER the (unchanged) label-gating logic so the
//    cap can never influence which decision branch is chosen.

// ===========================================================================
// A. Market Size / CAGR / TAM-SAM-SOM -- query construction
// ===========================================================================

test("A1: extractDynamicProductCategory (via getMarketTaxonomyProfile) no longer breaks on 'U.S.' -- the exact reported production prompt shape", () => {
  const profile = getMarketTaxonomyProfile(
    "Generate a comprehensive Market Intelligence report on the mature U.S. commercial real estate services market"
  );
  assert.doesNotMatch(profile.productCategory, /^a on the/i, "must not reproduce the confirmed garbage extraction");
  assert.match(profile.productCategory, /commercial real estate services/i);
});

test("A2: other common period-containing abbreviations (U.K., Inc.) do not break category extraction either", () => {
  const ukProfile = getMarketTaxonomyProfile(
    "Generate a Market Intelligence report on the U.K. legal AI software market"
  );
  assert.match(ukProfile.productCategory, /legal/i);
  assert.match(ukProfile.productCategory, /software/i);
  assert.doesNotMatch(ukProfile.productCategory, /^a on the|report on/i, "must not reproduce the confirmed garbage-truncation shape");
});

test("A3: prompts with no abbreviation are completely unaffected (no regression)", () => {
  const profile = getMarketTaxonomyProfile("Analyze the cybersecurity SaaS market");
  assert.match(profile.productCategory, /cybersecurity SaaS/i);
});

function planFor(prompt) {
  const expertiseProfile = createExpertiseProfileFallback({ prompt, selectedMode: "market" });
  const reportPlan = createDynamicReportPlanFallback({ expertiseProfile, selectedMode: "market", prompt });
  return buildMarketResearchTasks({ expertiseProfile, reportPlan, prompt });
}

test("A4: the market-size research task's actual query string still contains the literal 'market size CAGR' intent phrase even with a long U.S.-shaped category prefix (previously silently truncated away)", () => {
  const tasks = planFor(
    "Generate a comprehensive Market Intelligence report on the mature U.S. commercial real estate services market"
  );
  const marketSizeTask = tasks.find((task) => task.field === "market_size");
  assert.ok(marketSizeTask, "market_size task must exist");
  assert.ok(marketSizeTask.query.length <= 220, "the query must still respect its overall length budget");
  assert.match(
    marketSizeTask.query,
    /market size CAGR/i,
    `the query must never silently drop its own research intent to truncation: got "${marketSizeTask.query}"`
  );
});

// ===========================================================================
// B. Authority scoring -- known market-research publishers
// ===========================================================================

test("B1: a real IBISWorld/Grand View Research citation is recognized as an authoritative market-evidence source, not demoted below a random blog", () => {
  const ibisworld = {
    publisher: "IBISWorld",
    url: "https://www.ibisworld.com/united-states/market-research-reports/commercial-real-estate-services",
    sourceType: "credible_market_data",
    sourceTitle: "Commercial Real Estate Services in the US - Market Research Report",
    field: "market_size",
  };
  const grandView = {
    publisher: "Grand View Research",
    url: "https://www.grandviewresearch.com/industry-analysis/commercial-real-estate-market",
    sourceType: "credible_market_data",
    sourceTitle: "Commercial Real Estate Market Size, Share & Trends Report",
    field: "market_size",
  };
  assert.equal(isAuthoritativeMarketEvidenceSource(ibisworld), true);
  assert.equal(isAuthoritativeMarketEvidenceSource(grandView), true);
  assert.equal(classifyMarketEvidenceSource(ibisworld), "market_research");
  assert.equal(classifyMarketEvidenceSource(grandView), "market_research");
});

test("B2: a random, unaffiliated blog is NOT promoted to an authoritative source -- evidence standards are not weakened", () => {
  const blog = {
    publisher: "Some Random Blog",
    url: "https://someblog.example.com/thoughts-on-real-estate",
    sourceType: "credible_market_data",
    sourceTitle: "My thoughts on the office market",
    field: "market_size",
  };
  assert.equal(isAuthoritativeMarketEvidenceSource(blog), false);
  assert.equal(classifyMarketEvidenceSource(blog), "other");
});

test("B3: the two authority classifiers can never diverge -- a source isAuthoritativeMarketEvidenceSource recognizes always lands in a high-authority classifyMarketEvidenceSource tier (rank <= 4), never 'other'", () => {
  const highAuthorityTiers = new Set(["government_statistics", "financial_filing", "industry_association", "market_research"]);
  const cases = [
    { publisher: "Mordor Intelligence", url: "https://www.mordorintelligence.com/x", sourceType: "credible_market_data", sourceTitle: "Market report", field: "market_size" },
    { publisher: "Some Trade Association", url: "https://example-institute.org/report", sourceType: "credible_market_data", sourceTitle: "The Example Institute is a market research firm covering this industry", field: "market_size" },
  ];
  for (const item of cases) {
    const authoritative = isAuthoritativeMarketEvidenceSource(item);
    const tier = classifyMarketEvidenceSource(item);
    if (authoritative) {
      assert.ok(highAuthorityTiers.has(tier), `${item.publisher} must classify into a high-authority tier when recognized as authoritative, got "${tier}"`);
    }
  }
});

// ===========================================================================
// C. Competitive Landscape -- competitor extraction
// ===========================================================================

const checkedAt = "2026-08-27T00:00:00.000Z";
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

const creMarketPrompt = "Evaluate the mature U.S. commercial real estate services market.";

test("C1: an enumeration sentence ('the leading firms are X, Y, and Z') extracts every real company name, including one with an internal '&'", () => {
  const evidence = [
    baseEvidence({
      claim: "The leading commercial real estate services firms are CBRE, JLL, Cushman & Wakefield, Colliers, and Newmark.",
      value: "Market leadership enumeration",
      sourceTitle: "CRE Industry Overview",
      publisher: "IBISWorld",
      url: "https://www.ibisworld.com/cre-overview",
    }),
  ];
  const mentions = extractVendorCandidateMentions(evidence, null).map((m) => m.name);
  for (const expected of ["CBRE", "JLL", "Cushman & Wakefield", "Colliers", "Newmark"]) {
    assert.ok(mentions.includes(expected), `expected ${expected} in ${JSON.stringify(mentions)}`);
  }
});

test("C2: ranking/revenue framing ('X reported revenue of $Y', 'X ranked #N') extracts real company names, industry-agnostic (no company hardcoded)", () => {
  const evidence = [
    baseEvidence({
      claim: "JLL ranked #2 by revenue in the global commercial real estate services market.",
      value: "JLL ranking",
      sourceTitle: "Industry ranking report",
      publisher: "Grand View Research",
      url: "https://www.grandviewresearch.com/cre-ranking",
    }),
  ];
  const mentions = extractVendorCandidateMentions(evidence, null).map((m) => m.name);
  assert.ok(mentions.includes("JLL"));
});

test("C3: a bare corporate-suffix fragment ('Inc.') isolated by a comma-broken match is filtered out, never treated as its own candidate", () => {
  const evidence = [
    baseEvidence({
      claim: "CBRE Group, Inc. reported 2024 revenue of $35.8 billion, the largest among commercial real estate services firms.",
      value: "CBRE revenue disclosure",
      sourceTitle: "CBRE Annual Report",
      publisher: "CBRE Group",
      url: "https://www.cbre.com/about/investor-relations",
    }),
  ];
  const mentions = extractVendorCandidateMentions(evidence, null).map((m) => m.name);
  assert.ok(!mentions.some((name) => /^inc\.?$/i.test(name)), `a bare "Inc." fragment must never survive as a candidate, got: ${JSON.stringify(mentions)}`);
});

test("C4: an enumerated list bleeding into an unrelated adjacent sentence (via the claim/value/sourceTitle text-join) is correctly bounded at the sentence's own period", () => {
  const evidence = [
    baseEvidence({
      claim: "The leading commercial real estate services firms are CBRE, JLL, Cushman & Wakefield, Colliers, and Newmark.",
      value: "Market leadership enumeration",
      sourceTitle: "CRE Industry Overview",
      publisher: "IBISWorld",
      url: "https://www.ibisworld.com/cre-overview",
    }),
  ];
  const mentions = extractVendorCandidateMentions(evidence, null).map((m) => m.name);
  assert.ok(
    !mentions.some((name) => /market/i.test(name) || name.includes(".")),
    `no candidate should bleed into the following field's own leading word, got: ${JSON.stringify(mentions)}`
  );
});

test("C5: classifyOrganizationEntity recognizes ticker-symbol adjacency and about/investor-relations paths as an industry-agnostic commercial_vendor signal", () => {
  const withTicker = classifyOrganizationEntity({
    name: "CBRE Group",
    url: "https://www.cbre.com/about",
    sourceType: "official_company_source",
    context: "CBRE Group, Inc. (NYSE:CBRE) is the world's largest commercial real estate services and investment firm.",
  });
  assert.equal(withTicker.entityType, "commercial_vendor");

  const withAboutPath = classifyOrganizationEntity({
    name: "CBRE Group",
    url: "https://www.cbre.com/about-us",
    sourceType: "official_company_source",
    context: "Learn more about our commercial real estate services.",
  });
  assert.equal(withAboutPath.entityType, "commercial_vendor");
});

test("C6 (no evidence-standard weakening, regression guard): a customer's press release about USING a product is still correctly rejected, even though its URL happens to contain 'about-' as a SUBSTRING of an unrelated path segment", () => {
  // The exact real citation shape that regressed during this fix's first
  // pass: DSV's own press release lives under "/about-dsv/press/news/...".
  // An unanchored "/about" match would incorrectly treat this as the
  // company's own official profile page; the fix requires a full path
  // SEGMENT boundary ("/about/" or "/about-us/", not "/about-dsv/").
  const result = classifyOrganizationEntity({
    name: "DSV",
    url: "https://www.dsv.com/en/about-dsv/press/news/com/2020/11/dsv-improves-warehouse-operations-with-drone-system",
    sourceType: "official company source",
    context: "DSV improves warehouse operations with drone system.",
  });
  assert.notEqual(result.entityType, "commercial_vendor", "a customer's press coverage must never become a vendor merely from an unrelated URL substring");
});

test("C7 (end-to-end): validated enumeration + ranking evidence for a mature services market reaches real, honestly-labeled player rows -- never an empty/Validation-Needed table with zero names, and never silently discarded", () => {
  const evidence = [
    baseEvidence({
      claim: "The leading commercial real estate services firms are CBRE, JLL, Cushman & Wakefield, Colliers, and Newmark.",
      value: "Market leadership enumeration",
      sourceTitle: "Commercial Real Estate Services in the US - Market Research Report",
      publisher: "IBISWorld",
      url: "https://www.ibisworld.com/cre-overview",
    }),
    baseEvidence({
      claim: "CBRE Group, Inc. (NYSE:CBRE) reported 2024 revenue of $35.8 billion, the largest among commercial real estate services firms.",
      value: "CBRE revenue disclosure",
      sourceTitle: "CBRE Annual Report",
      publisher: "CBRE Group",
      url: "https://www.cbre.com/about/investor-relations",
    }),
    baseEvidence({
      claim: "JLL ranked #2 by revenue in the global commercial real estate services market.",
      value: "JLL ranking",
      sourceTitle: "Industry ranking report",
      publisher: "Grand View Research",
      url: "https://www.grandviewresearch.com/cre-ranking",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, creMarketPrompt);

  // This fixture's evidence is real but thin per company (1-2 mentions
  // each) -- not enough to clear validateVendorCandidate's stricter,
  // unmodified "vendors" (direct competitor) bar, which this fix does
  // NOT loosen (that bar is a deliberate, separate evidence-integrity
  // gate from an earlier P0 fix). The correct, already-designed honest
  // outcome for evidence this thin is adjacentPlayers -- surfaced in
  // Major Players, while Competitive Landscape correctly stays
  // "Validation Needed" for the stricter direct-competitor claim. The
  // bug this fix closes was that these real, named companies were
  // discarded entirely (surviving in NEITHER field) -- not that they
  // failed to reach the stricter tier they were never evidenced enough
  // to reach.
  assert.ok(
    ["CBRE", "JLL", "Colliers", "Newmark", "Cushman & Wakefield"].some((name) =>
      graph.vendorIntelligence.adjacentPlayers.some((player) => player.name === name)
    ),
    "at least one real company must survive to adjacentPlayers"
  );
  assert.ok(
    graph.vendorIntelligence.adjacentPlayers.length >= 3,
    `expected most of the 5 real enumerated companies to survive discovery, got: ${JSON.stringify(graph.vendorIntelligence.adjacentPlayers.map((p) => p.name))}`
  );

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  const namedCount = ["CBRE", "JLL", "Colliers", "Newmark", "Cushman & Wakefield"].filter((name) =>
    projection.majorPlayers.includes(name)
  ).length;
  assert.ok(namedCount >= 3, `expected real named players to be honestly surfaced in Major Players, got:\n${projection.majorPlayers}`);
});

// ===========================================================================
// D. Duplicate content
// ===========================================================================

async function importPageDedupFunctions() {
  const source = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");

  function extractFunction(name) {
    const idx = source.indexOf(`function ${name}(`);
    const braceStart = source.indexOf("{", idx);
    let depth = 0;
    for (let i = braceStart; i < source.length; i++) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) return source.slice(idx, i + 1);
      }
    }
    throw new Error(`unbalanced function extraction for ${name}`);
  }

  const dir = mkdtempSync(join(tmpdir(), "zerinix-page-dedup-"));
  const outPath = join(dir, "page-dedup.mts");
  // extractSectionMainExplanation now lives once in report-presentation.ts
  // (shared with Planner.tsx, no longer a local page.tsx function) --
  // imported directly here rather than extracted from page.tsx's source.
  const harness = `
import { extractSectionMainExplanation, getSectionTakeaway, stripLeadingTakeawaySentence } from ${JSON.stringify(
    pathToFileURL(join(repoRoot, "app/lib/report-presentation.ts")).href
  )};

${extractFunction("extractRealBulletLines")}

export { extractRealBulletLines, extractSectionMainExplanation, getSectionTakeaway, stripLeadingTakeawaySentence };
`;
  writeFileSync(outPath, harness);
  return import(pathToFileURL(outPath).href);
}

const pageDedup = await importPageDedupFunctions();

test("D1: the exact reported production shape -- a numbered first bullet promoted to the Key Takeaway is no longer ALSO duplicated as the first bullet underneath it", () => {
  const content =
    "1) Integration-first add-on products are the dominant competitive vector this cycle.\n" +
    "2) Pricing bundling remains a secondary differentiator with real evidence.\n" +
    "3) Vendor consolidation continues across the mid-market segment.";

  const takeaway = pageDedup.getSectionTakeaway(content);
  const contentWithoutTakeawayDuplication = pageDedup.stripLeadingTakeawaySentence(content, takeaway);
  const bullets = pageDedup.extractRealBulletLines(contentWithoutTakeawayDuplication);

  assert.equal(takeaway, "1) Integration-first add-on products are the dominant competitive vector this cycle.");
  assert.ok(!bullets.some((bullet) => bullet.includes("Integration-first add-on products")), "the takeaway's own bullet must not reappear in the bullet list");
  assert.equal(bullets.length, 2);
});

test("D2 (no regression): a flowing-prose section's explanation still correctly skips only the takeaway sentence by index, unaffected by the bullets-only fix", () => {
  const content =
    "Integration-first bundling is reshaping vendor strategy across the mid-market. " +
    "A second, genuinely distinct sentence about pricing follows here. " +
    "A third sentence adds further analytical depth.\n" +
    "- Vendor A leads with a bundled offering.\n" +
    "- Vendor B focuses on point solutions.";

  const takeaway = pageDedup.getSectionTakeaway(content);
  const contentWithoutTakeawayDuplication = pageDedup.stripLeadingTakeawaySentence(content, takeaway);
  const explanation = pageDedup.extractSectionMainExplanation(content, takeaway);
  const bullets = pageDedup.extractRealBulletLines(contentWithoutTakeawayDuplication);

  assert.doesNotMatch(explanation, /Integration-first bundling is reshaping vendor strategy/);
  assert.match(explanation, /A second, genuinely distinct sentence about pricing follows here\./);
  assert.match(explanation, /A third sentence adds further analytical depth\./);
  assert.deepEqual(bullets, ["Vendor A leads with a bundled offering.", "Vendor B focuses on point solutions."]);
});

test("D3: stripLeadingTakeawaySentence correctly detects a duplicate even when the first sentence uses a markdown-bold lead-in (previously a false negative)", () => {
  const content =
    "**Integration-first bundling:** Vendors are bundling up to 40% of deals in FY24. A second, distinct sentence follows.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.doesNotMatch(stripped, /Integration-first bundling/);
  assert.match(stripped, /A second, distinct sentence follows\./);
});

test("D4 (no regression): a genuinely non-duplicate first sentence is left completely unchanged", () => {
  const content = "Completely distinct opening sentence with no duplication risk at all. Second sentence here.";
  const takeaway = "A totally different takeaway computed some other way.";
  assert.equal(stripLeadingTakeawaySentence(content, takeaway), content);
});

// ===========================================================================
// E. Confidence integrity
// ===========================================================================

function coverage(marketConfidence, competitiveEvidence, financialEvidence, productEvidence) {
  return { dimensions: { marketConfidence, competitiveEvidence, financialEvidence, productEvidence } };
}

test("E1: the exact reported shape -- neither decision-critical pillar resolved -- caps confidence severely, never reading as 'reasonably confident'", () => {
  const blend = coverage(70, 55, 60, 55);
  const raw = assessMarketEntryConfidence(blend);
  const gated = assessMarketEntryConfidence(blend, { marketSizingResolved: false, competitiveEvidenceResolved: false });

  assert.ok(raw.confidence > 50, "sanity check: the raw blend is the misleadingly-high number being fixed");
  assert.equal(gated.decision, "MONITOR");
  assert.ok(gated.confidence <= 30, `confidence must be severely capped when nothing resolved, got ${gated.confidence}`);
  assert.ok(gated.confidence < raw.confidence);
});

test("E2: exactly one decision-critical pillar unresolved applies a moderate (not severe) cap", () => {
  const blend = coverage(70, 55, 60, 55);
  const gated = assessMarketEntryConfidence(blend, { marketSizingResolved: true, competitiveEvidenceResolved: false });
  assert.ok(gated.confidence <= 50);
  assert.ok(gated.confidence > 30, "one resolved pillar should not be penalized as severely as zero resolved pillars");
});

test("E3: both decision-critical pillars resolved -- confidence is completely unchanged (no unnecessary penalty)", () => {
  const blend = coverage(70, 55, 60, 55);
  const raw = assessMarketEntryConfidence(blend);
  const gated = assessMarketEntryConfidence(blend, { marketSizingResolved: true, competitiveEvidenceResolved: true });
  assert.equal(gated.confidence, raw.confidence);
});

test("E4 (backward compatible): calling with no decisionCriticalEvidence argument at all behaves exactly as before this fix", () => {
  const blend = coverage(70, 55, 60, 55);
  const result = assessMarketEntryConfidence(blend);
  assert.equal(result.confidence, Math.round(70 * 0.4 + 55 * 0.25 + 60 * 0.2 + 55 * 0.15));
});

test("E5: a genuinely strong, fully-evidenced report can still reach ENTER at full confidence -- the fix never punishes real evidence", () => {
  const strong = coverage(95, 90, 90, 90);
  const result = assessMarketEntryConfidence(strong, { marketSizingResolved: true, competitiveEvidenceResolved: true });
  assert.equal(result.decision, "ENTER");
  assert.ok(result.confidence >= 90);
});

test("E6: a strong raw blend that would independently cross the ENTER threshold is still forced to MONITOR with a capped number when evidence is missing -- label and number can never disagree", () => {
  const strong = coverage(95, 90, 90, 90);
  const gated = assessMarketEntryConfidence(strong, { marketSizingResolved: false, competitiveEvidenceResolved: false });
  assert.equal(gated.decision, "MONITOR");
  assert.equal(gated.evidenceGapBlocksStrongDecision, true);
  assert.ok(gated.confidence <= 30, "a report this evidence-poor must never display a high-90s confidence number regardless of the raw blend");
});

test("E7: buildMarketEntryRecommendation is wired to the same decisionCriticalEvidence as the main executive banner, so Strategic Recommendations can never contradict it", () => {
  const routeSource = readFileSync(join(repoRoot, "app/api/market-analysis/route.ts"), "utf8");
  assert.match(
    routeSource,
    /buildMarketEntryRecommendation\(normalized, language, coverage, decisionCriticalEvidence\)/
  );
});
