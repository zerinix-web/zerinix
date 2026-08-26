import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import {
  getSectionTakeaway,
  stripLeadingTakeawaySentence,
  resolveCagrHeadlinePresentation,
} from "../app/lib/report-presentation.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";
import { assessMarketRelevance } from "../app/lib/ai/vendor-discovery.ts";
import { stripInternalImplementationTokens } from "../app/lib/report-output-sanitization.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// P0 FIX #8 -- Production Report Output Sanitization & Deduplication.
//
// Four confirmed live production defects, fixed at their canonical
// presentation/generation layer (never section-specific hardcoded
// strings, never a weakening of P0 #1-#7's evidence standards):
//
// 1. DUPLICATE REPORT CONTENT -- ReportPdfButton.tsx's "Key Takeaway box
//    above + full body prose below" design never removed the leading
//    sentence/bulleted item from the body once it was also promoted to
//    the Key Takeaway box (page.tsx already avoided this via
//    extractSectionMainExplanation; the PDF had no equivalent). Fixed by
//    a new canonical function, stripLeadingTakeawaySentence
//    (report-presentation.ts), wired into ReportPdfButton.tsx's
//    sectionBodyContent computation for exactly the 9 Key-Takeaway-card
//    fields (pdfKeyTakeawayCardFields). While building this fix, a real
//    bug was found and fixed in the same pass: getSectionTakeaway's
//    takeaway text retains a leading bullet/numbered marker verbatim
//    ("1) Integration-first add-on products...", the EXACT reported
//    production shape) but the dedup function's bullet branch compared
//    against the marker-STRIPPED first line, so the two never matched
//    and nothing was removed -- normalizedTakeaway now strips the same
//    leading marker before comparison.
//
// 2. COMPETITIVE LANDSCAPE DATA FLOW -- validated commercial vendor
//    evidence (e.g. Clio, MyCase discovered via third-party review
//    coverage, never an official vendor page) was silently discarded
//    before reaching adjacentPlayers: classifyOrganizationEntity's
//    "commercial_vendor" bar required an exact phrase match
//    ("company website"/"product page"/"pricing page"/"commercial
//    software"/"software vendor") that ordinary review/press evidence
//    rarely contains verbatim, so it fell through to "unknown" and was
//    excluded by adjacentPlayerCandidates' gate regardless of the
//    evidence's real quality. Fixed in vendor-intelligence.ts by
//    upgrading an "unknown" classification to "commercial_vendor" when
//    the candidate was NOT reached only via a bare domain fallback (i.e.
//    a genuine heuristic vendor-signal mention exists). A second, related
//    gap in assessMarketRelevance (vendor-discovery.ts) excluded vendors
//    described with forward customer-framing ("rated highly by law firm
//    reviewers") because the existing pattern only recognized framing
//    BEFORE the professional-services term ("used by"/"trusted by law
//    firms"); a new customerFramingAfterProfessionalServicesFirmPattern
//    now also recognizes role-nouns immediately AFTER the term. Separately,
//    both PDF Competitive Landscape render branches (Market Intelligence
//    and generic) had a self-referential fallback string --
//    "See the Competitive Landscape section for full competitor detail."
//    inside the Competitive Landscape section's own render -- replaced
//    with page.tsx's existing honest wording, "No competitor data could
//    be validated for this market yet."
//
// 3. CAGR SCOPE / KPI SEMANTICS -- extractHeadlineCagrValue's plain
//    first-match regex silently promoted whichever growth-rate figure
//    happened to appear first in the evidence as if it were the single
//    authoritative CAGR, even when the evidence named more than one
//    materially different estimate (7.0% vs 9.8% on differently-scoped
//    bases in the reported production report). Fixed via a new
//    resolveCagrHeadlinePresentation (report-presentation.ts) that
//    detects genuine multi-value disagreement (never a value repeated by
//    multiple sources) and returns an honest "low%-high%" range instead
//    of picking one; wired into all 3 known CAGR display call sites
//    (page.tsx's Market Metrics card and MarketMetricsDashboard tile,
//    ReportPdfButton.tsx's Key Metrics tile). The single-estimate case
//    (the common case) continues to use extractHeadlineCagrValue exactly
//    as before -- resolveCagrHeadlinePresentation only overrides the
//    display value when isMultiEstimate is true, so the already-pinned
//    extractHeadlineCagrValue function needed no deletion. page.tsx's
//    Market Metrics evidence classification is forced to "benchmarkDerived"
//    (never "verified") when the range is multi-estimate, since no single
//    evidence line supports a two-number range.
//
// 4. INTERNAL/DEBUG TOKEN LEAKAGE -- the model is shown the full market
//    intelligence graph as raw JSON (formatMarketIntelligenceGraphForModel)
//    so it can synthesize evidence-grounded prose, but that JSON's
//    camelCase key names (sizingGap, matchedByTaxonomy,
//    confidenceClassification, ...) are code identifiers, not vocabulary,
//    and the model sometimes echoed one verbatim into report prose. Fixed
//    with (a) a reinforced prompt instruction directly beside the JSON
//    dump naming the risk explicitly, and (b) a generic defensive
//    sanitizer added to route.ts's marketReportTermReplacements: any
//    bracket-wrapped lowercase-start/internal-capital token (the
//    "[sizingGap]" shape -- never used by this pipeline's real bracket
//    tags, which are Title-Case: [Verified]/[Estimated]/[Assumption]/
//    [R#]/[Asset: ...]/[User]/[Method: ...]) is stripped generically, and
//    a schema-derived enumeration of known bare internal field names is
//    stripped by exact match (never a blanket camelCase heuristic, which
//    would false-positive on real terms like "eCommerce"/"iPhone").
//    Separately, the existing "Assumption(s)"->"Planning inputs" and "AI
//    Assumptions"->"Planning inputs" relabeling rules were unconditional
//    whole-word replacements that also fired on ordinary prose use of the
//    word ("...holds only if this assumption about adoption remains
//    true..."), producing exactly the reported "'Planning inputs'
//    inserted unnaturally into prose" defect; scoped with a lookahead so
//    they only fire on the intended LABEL usage (a bracketed tag or a
//    colon-terminated header), never inside a sentence.

// ---------------------------------------------------------------------------
// Shared fixture helpers (same shape as
// tests/market-intelligence-competitor-existence-vs-ranking.test.mjs)
// ---------------------------------------------------------------------------

const checkedAt = "2026-08-22T00:00:00.000Z";
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

// A genuine third-party review mention -- NOT an official vendor page, NOT
// a taxonomy-alias match -- the exact evidence shape (heuristic_mention,
// classifyOrganizationEntity's narrow phrase bar not met) that was
// silently discarded before this fix.
function reviewMention({ name, domain }) {
  return baseEvidence({
    claim: `${name} offers a highly rated practice management platform used by buyers researching this category.`,
    value: `${name} customer review summary`,
    sourceTitle: `${name} reviews and ratings`,
    publisher: domain,
    url: `https://${domain}/reviews/${encodeURIComponent(name.toLowerCase())}`,
  });
}

const legalTechPrompt = "Analyze the U.S. AI-powered LegalTech SaaS market for small law firms.";

// ---------------------------------------------------------------------------
// Extraction helper for route.ts's sanitizeMarketReportContent -- route.ts
// is a Next.js API route with import-time Supabase/env dependencies that
// cannot be safely imported whole in a test process, so only the
// self-contained sanitization block (which depends solely on two plain,
// side-effect-free util modules) is extracted, following the same
// balanced-brace extraction-to-temp-module technique already established
// elsewhere in this suite (see e.g.
// tests/aml-fraud-geography-and-source-relevance-fixes.test.mjs's
// importFinancialModel).
// ---------------------------------------------------------------------------

function extractBalancedBlock(source, startIndex) {
  let depth = 0;
  let started = false;
  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      depth += 1;
      started = true;
    } else if (ch === "}") {
      depth -= 1;
      if (started && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error("extractBalancedBlock: no balanced closing brace found");
}

async function importSanitizeMarketReportContent() {
  const routeSourcePath = join(repoRoot, "app/api/market-analysis/route.ts");
  const routeSource = readFileSync(routeSourcePath, "utf8");

  const startMarker = "const marketReportFinancialAcronymReplacements";
  const startIdx = routeSource.indexOf(startMarker);
  assert.notEqual(startIdx, -1, "marketReportFinancialAcronymReplacements must exist in route.ts");

  const funcMarker = "function sanitizeMarketReportContent(value: string) {";
  const funcIdx = routeSource.indexOf(funcMarker, startIdx);
  assert.notEqual(funcIdx, -1, "sanitizeMarketReportContent must exist in route.ts");

  const braceStart = routeSource.indexOf("{", funcIdx);
  const functionBlock = extractBalancedBlock(routeSource, braceStart);
  const combinedBlock = routeSource.slice(startIdx, braceStart) + functionBlock;

  const responseSanitizationUrl = pathToFileURL(
    join(repoRoot, "app/lib/ai/response-sanitization.ts")
  ).href;
  const pdfNormalizationUrl = pathToFileURL(join(repoRoot, "app/lib/pdf-normalization.mjs")).href;
  const reportOutputSanitizationUrl = pathToFileURL(
    join(repoRoot, "app/lib/report-output-sanitization.ts")
  ).href;

  const harness = `
import { sanitizeAiResponseText } from ${JSON.stringify(responseSanitizationUrl)};
import { normalizePdfText } from ${JSON.stringify(pdfNormalizationUrl)};
import { stripInternalImplementationTokens } from ${JSON.stringify(reportOutputSanitizationUrl)};

${combinedBlock}

export { sanitizeMarketReportContent };
`;

  const dir = mkdtempSync(join(tmpdir(), "zerinix-market-sanitize-"));
  const outPath = join(dir, "sanitize.mts");
  writeFileSync(outPath, harness);
  return import(pathToFileURL(outPath).href);
}

const { sanitizeMarketReportContent } = await importSanitizeMarketReportContent();

const routeSource = readFileSync(join(repoRoot, "app/api/market-analysis/route.ts"), "utf8");
const pdfSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const chatRouteSource = readFileSync(join(repoRoot, "app/api/chat/route.ts"), "utf8");

// ===========================================================================
// A. Key Takeaway / body duplication removed without deleting distinct content
// ===========================================================================

test("A1: exact reported production shape -- numbered first line duplicated as Key Takeaway is removed as a whole item, distinct second item survives with its citation", () => {
  const content =
    "1) Integration-first add-on products are the dominant competitive vector this cycle.\n" +
    "2) Pricing bundling remains a secondary differentiator with real evidence [R2].";
  const takeaway = getSectionTakeaway(content);
  assert.equal(takeaway, "1) Integration-first add-on products are the dominant competitive vector this cycle.");

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.doesNotMatch(stripped, /Integration-first add-on products are the dominant competitive vector/);
  assert.match(stripped, /Pricing bundling remains a secondary differentiator with real evidence \[R2\]\./);
});

test("A2: flowing-prose duplicated first sentence is removed, later sentences with numbers and citations are untouched", () => {
  const content =
    "Integration-first add-on products are reshaping vendor bundling strategy. " +
    "A second, distinct sentence about pricing evidence follows here. " +
    "A third sentence cites [R3] with a real number: $42M.";
  const takeaway = getSectionTakeaway(content);
  const stripped = stripLeadingTakeawaySentence(content, takeaway);

  assert.doesNotMatch(stripped, /Integration-first add-on products are reshaping vendor bundling strategy\./);
  assert.match(stripped, /A second, distinct sentence about pricing evidence follows here\./);
  assert.match(stripped, /A third sentence cites \[R3\] with a real number: \$42M\./);
});

test("A3: content whose first line does not duplicate the takeaway is returned completely unchanged (conservative fallback)", () => {
  const content = "Completely distinct opening sentence with no duplication risk at all. Second sentence here.";
  const takeaway = "A totally different takeaway computed some other way.";
  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.equal(stripped, content);
});

test("A4: empty takeaway or empty content never throws and returns content unchanged", () => {
  assert.equal(stripLeadingTakeawaySentence("Some content.", ""), "Some content.");
  assert.equal(stripLeadingTakeawaySentence("", "Some takeaway."), "");
});

test("A5: ReportPdfButton.tsx's sectionBodyContent computation is wired to stripLeadingTakeawaySentence for exactly the 9 Key-Takeaway-card fields, not for every section", () => {
  assert.match(
    pdfSource,
    /const isKeyTakeawayCardSection = pdfKeyTakeawayCardFields\.has\(section\.field \?\? ""\);/
  );
  assert.match(
    pdfSource,
    /const sectionContentWithoutTakeawayDuplication = isKeyTakeawayCardSection\s*\n\s*\? stripLeadingTakeawaySentence\(section\.content, getSectionTakeaway\(section\.content\)\)\s*\n\s*: section\.content;/
  );
  const pdfKeyTakeawayFieldsMatch = pdfSource.match(/const pdfKeyTakeawayCardFields = new Set\(\[([^\]]+)\]\)/);
  assert.ok(pdfKeyTakeawayFieldsMatch, "pdfKeyTakeawayCardFields must still exist");
  for (const field of [
    "marketDrivers",
    "barriers",
    "opportunities",
    "threats",
    "customerSegments",
    "majorPlayers",
    "regionalAnalysis",
    "industryTrends",
    "marketSegmentation",
  ]) {
    assert.match(pdfKeyTakeawayFieldsMatch[1], new RegExp(`"${field}"`));
  }
});

// ===========================================================================
// B. Validated competitor evidence reaches Competitive Landscape rows;
//    unsupported ranking remains withheld
// ===========================================================================

test("B1: vendors discovered only via third-party review coverage (no official page) clear validation and populate BOTH Competitive Landscape and Major Players with honest, non-fabricated fields", () => {
  const evidence = [
    reviewMention({ name: "Clio", domain: "g2.example.com" }),
    reviewMention({ name: "Clio", domain: "capterra.example.com" }),
    reviewMention({ name: "MyCase", domain: "g2.example.com" }),
    reviewMention({ name: "MyCase", domain: "capterra.example.com" }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);

  const vendorNames = graph.vendorIntelligence.vendors.map((v) => v.name);
  assert.ok(vendorNames.includes("Clio"), "Clio must clear vendor validation from review-only evidence");
  assert.ok(vendorNames.includes("MyCase"), "MyCase must clear vendor validation from review-only evidence");

  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.match(projection.competitiveLandscape, /Clio/);
  assert.match(projection.competitiveLandscape, /MyCase/);
  assert.doesNotMatch(
    projection.competitiveLandscape,
    /See the Competitive Landscape section/i,
    "must never self-referentially point back to its own section"
  );
  // No fabricated pricing/positioning -- fields without evidence must
  // remain explicitly withheld, never invented.
  assert.match(projection.competitiveLandscape, /Not disclosed in public sources|Not independently confirmed/);
});

test("B2: forward customer-framing ('rated highly by law firm reviewers') is not mistaken for the vendor self-describing as a law firm", () => {
  const candidate = { canonicalName: "Casewell" };
  const result = assessMarketRelevance(
    candidate,
    null,
    "Casewell is rated highly by law firm reviewers for its matter management features.",
    legalTechPrompt
  );
  assert.equal(result.relevant, true);
  assert.doesNotMatch(result.reason, /implementation partner|marketplace|distributor|advisory firm/i);
});

test("B3: a genuine self-described law firm (not a vendor) is still correctly excluded -- the fix must not blanket-allow every 'law firm' mention", () => {
  const candidate = { canonicalName: "Smith & Associates" };
  const result = assessMarketRelevance(
    candidate,
    null,
    "Smith & Associates is a boutique law firm specializing in intellectual property litigation.",
    legalTechPrompt
  );
  assert.equal(result.relevant, false);
});

test("B4: no defensible competitor evidence at all -- Competitive Landscape stays honestly empty, never fabricated", () => {
  const evidence = [
    baseEvidence({
      claim: "General commentary about the market with no numeric size figure or named vendor.",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.example.com/overview",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Analyze an obscure niche market.");
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.doesNotMatch(projection.competitiveLandscape, /\$\d/, "must never fabricate a company or figure");
});

test("B5: both PDF Competitive Landscape render branches use the honest empty-state wording, never the self-referential fallback", () => {
  assert.doesNotMatch(pdfSource, /See the Competitive Landscape section for full competitor detail\./);
  const matches = pdfSource.match(/No competitor data could be validated for this market yet\./g) || [];
  assert.ok(matches.length >= 2, "both the Market Intelligence and generic competitor branches must use the honest wording");
});

// ===========================================================================
// C. Conflicting/different-scope CAGR estimates cannot become a misleading
//    single authoritative headline KPI
// ===========================================================================

test("C1: two materially different sourced CAGR estimates (the exact reported 7.0% / 9.8% shape) produce an honest range, never a single silently-chosen figure", () => {
  const content =
    "USD 7,316.9M in 2024 growing to USD 13,116.4M in 2033, CAGR 7.0%. " +
    "A separately scoped estimate cites USD 25.5B in 2024 growing to USD 65.3B in 2034, CAGR 9.8%.";
  const result = resolveCagrHeadlinePresentation(content);
  assert.equal(result.isMultiEstimate, true);
  assert.equal(result.displayValue, "7.0%–9.8%");
});

test("C2: the same figure restated by multiple sources is NOT treated as a conflict -- single-estimate display is unchanged", () => {
  const content = "CAGR of 7.0% is cited by two independent sources, one restating 7.0% again.";
  const result = resolveCagrHeadlinePresentation(content);
  assert.equal(result.isMultiEstimate, false);
  assert.equal(result.displayValue, "7.0%");
});

test("C3: no percentage present resolves to the existing empty/Validation Needed state, never a fabricated figure", () => {
  const result = resolveCagrHeadlinePresentation("No percentage figure available for this market yet.");
  assert.equal(result.isMultiEstimate, false);
  assert.equal(result.displayValue, "");
});

test("C4: page.tsx and ReportPdfButton.tsx all 3 known CAGR display call sites route through resolveCagrHeadlinePresentation, and the single-estimate case still falls back to the pinned extractHeadlineCagrValue (no dead code, no test-parity break)", () => {
  const pageOccurrences = pageSource.match(/resolveCagrHeadlinePresentation\(/g) || [];
  const pdfOccurrences = pdfSource.match(/resolveCagrHeadlinePresentation\(/g) || [];
  assert.ok(pageOccurrences.length >= 2, "page.tsx must call resolveCagrHeadlinePresentation at both CAGR display sites");
  assert.ok(pdfOccurrences.length >= 1, "ReportPdfButton.tsx must call resolveCagrHeadlinePresentation at its CAGR tile");

  assert.match(pageSource, /function extractHeadlineCagrValue\(content: string\)/, "the pinned function must not be deleted");
  assert.match(pdfSource, /function extractHeadlineCagrValue\(content: string\)/, "the pinned function must not be deleted");

  const pageCagrCallSites = pageSource.match(/isMultiEstimate\s*\?\s*cagrPresentation!?\.displayValue\s*:\s*extractHeadlineCagrValue\(/g) || [];
  const pdfCagrCallSites = pdfSource.match(/isMultiEstimate\s*\?\s*cagrPresentation\.displayValue\s*:\s*extractHeadlineCagrValue\(/g) || [];
  assert.ok(pageCagrCallSites.length >= 2, "page.tsx must keep extractHeadlineCagrValue as the single-estimate source of truth");
  assert.ok(pdfCagrCallSites.length >= 1, "ReportPdfButton.tsx must keep extractHeadlineCagrValue as the single-estimate source of truth");
});

test("C5: page.tsx forces the CAGR evidence tier to benchmarkDerived (never verified) when the estimate is a multi-source range", () => {
  assert.match(
    pageSource,
    /const evidence =\s*\n\s*isCagr && cagrPresentation\?\.isMultiEstimate\s*\n\s*\?\s*\("benchmarkDerived" as const\)/
  );
});

// ===========================================================================
// D. Internal markers (sizingGap/[sizingGap]/etc.) cannot reach live
//    presentation or PDF-ready presentation data
// ===========================================================================

test("D1: the exact reported bare 'sizingGap' leak is removed from prose while surrounding meaningful content survives", () => {
  const output = sanitizeMarketReportContent(
    "Due to the sizingGap in pricing evidence, the TAM could not be triangulated with a bottom-up figure."
  );
  assert.doesNotMatch(output, /sizingGap/i);
  assert.match(output, /pricing evidence/);
  assert.match(output, /TAM could not be triangulated/);
});

test("D2: the exact reported bracketed '[sizingGap]' leak is removed entirely, including its brackets", () => {
  const output = sanitizeMarketReportContent(
    "[sizingGap] Serviceable share could not be validated for this segment."
  );
  assert.doesNotMatch(output, /\[sizingGap\]/i);
  assert.doesNotMatch(output, /sizingGap/i);
  assert.match(output, /Serviceable share could not be validated for this segment\./);
});

test("D3: a real internal identifier this codebase actually uses (matchedByTaxonomy) is stripped without needing to be named in any list", () => {
  const output = sanitizeMarketReportContent(
    "Clio was matchedByTaxonomy and confirmed as a commercial vendor via its official pricing page."
  );
  assert.doesNotMatch(output, /matchedByTaxonomy/i);
  assert.match(output, /Clio/);
  assert.match(output, /confirmed as a commercial vendor via its official pricing page/);
});

test("D4: an unknown/future bracket-wrapped camelCase identifier is caught by the generic shape heuristic alone", () => {
  const output = sanitizeMarketReportContent(
    "[someFutureInternalKeyNotYetEnumerated] Market size could not be established."
  );
  assert.doesNotMatch(output, /\[someFutureInternalKeyNotYetEnumerated\]/);
  assert.match(output, /Market size could not be established\./);
});

test("D5: legitimate bracket tags (Title-Case evidence labels) are never touched by the generic internal-token stripper", () => {
  const verified = sanitizeMarketReportContent("[Verified] Market size is $7.3B in 2024 [R1].");
  assert.match(verified, /\[Verified\]/);
  assert.match(verified, /\[R1\]/);
});

test("D6: sanitization never destroys validated numeric values or citations", () => {
  const output = sanitizeMarketReportContent(
    "productCategory data confirms a 7.0% CAGR from 2024 to 2033 [R2]."
  );
  assert.doesNotMatch(output, /productCategory/i);
  assert.match(output, /7\.0%/);
  assert.match(output, /2024 to 2033/);
  assert.match(output, /\[R2\]/);
});

test("D7: ordinary English words that share the internal-identifier bracket SHAPE but are real product names (eCommerce) are never stripped bare", () => {
  const output = sanitizeMarketReportContent(
    "The eCommerce vertical shows strong efficiency compared to legal tech."
  );
  assert.match(output, /eCommerce/);
});

test("D8: 'Planning inputs' relabeling fires only on label usage (bracket tag or colon header), never mid-sentence -- the exact reported 'inserted unnaturally into prose' defect", () => {
  const midSentence = sanitizeMarketReportContent(
    "This recommendation holds only if the assumption about steady adoption remains true."
  );
  assert.match(midSentence, /\bassumption\b/i);
  assert.doesNotMatch(midSentence, /Planning inputs/);

  const bracketLabel = sanitizeMarketReportContent(
    "[Assumption] Serviceable share is 25% until segment and geography data are validated."
  );
  assert.match(bracketLabel, /\[Planning inputs\]/);

  const colonHeader = sanitizeMarketReportContent("Critical Assumptions:\n- Adoption continues at current pace.");
  assert.match(colonHeader, /Planning inputs:/);
});

test("D9: route.ts no longer maintains its own enumerated internal-field-name list -- it calls the shared, schema-independent stripInternalImplementationTokens instead", () => {
  assert.doesNotMatch(
    routeSource,
    /knownInternalImplementationTokens|internalImplementationTokenReplacements/,
    "the old manually-maintained enumerated list must be fully removed, not left as dead/redundant code"
  );
  assert.match(
    routeSource,
    /import \{ stripInternalImplementationTokens \} from "@\/app\/lib\/report-output-sanitization";/
  );
  assert.match(
    routeSource,
    /stripInternalImplementationTokens\(sanitizeAiResponseText\(value\)\)/,
    "sanitizeMarketReportContent must route through the shared generic sanitizer"
  );
});

test("D10: chat/route.ts -- a genuinely separate presentation path from market-analysis/route.ts -- also calls the same shared stripInternalImplementationTokens, not a divergent or absent one", () => {
  assert.match(
    chatRouteSource,
    /import \{ stripInternalImplementationTokens \} from "@\/app\/lib\/report-output-sanitization";/
  );
  const wiredCallCount = (
    chatRouteSource.match(/stripInternalImplementationTokens\(sanitizeAiResponseText\(/g) || []
  ).length;
  assert.ok(
    wiredCallCount >= 3,
    "every real-model-output sanitizeAiResponseText call site in chat/route.ts (textStream, both completedText fallbacks, the final streamedText pass) must be wrapped"
  );
  // Confirm chat/route.ts is genuinely exposed to the same leak vector
  // this hardening pass closes (not a hypothetical concern) -- it also
  // dumps the market intelligence graph as raw JSON into its own prompt.
  assert.match(chatRouteSource, /formatMarketIntelligenceGraphForModel\(chatMarketGraph\)/);
});

// ---------------------------------------------------------------------------
// D11-D19: adversarial coverage -- previously unseen internal-sounding
// tokens, proving the sanitizer is not limited to known examples like
// sizingGap, plus a battery of real-world brand/company names verified
// NOT to be damaged by the generic heuristic. Exercises
// stripInternalImplementationTokens directly (imported for real from
// report-output-sanitization.ts) as well as through the full
// sanitizeMarketReportContent pipeline, so both the unit-level behavior
// and its wiring are covered.
// ---------------------------------------------------------------------------

test("D11: a completely invented internal-sounding identifier, never mentioned anywhere in this ticket or the codebase, is still caught (multi-hump shape alone is sufficient)", () => {
  for (const token of [
    "xyzWidgetFallbackReconciler",
    "zqlNormalizedTaxonomySignal",
    "quuxInternalRoutingHint",
    "provenanceLedgerCursorState",
  ]) {
    const output = stripInternalImplementationTokens(`The analysis relies on ${token} to reach this conclusion.`);
    assert.doesNotMatch(output, new RegExp(token, "i"), `${token} must be stripped without being named anywhere`);
    assert.match(output, /The analysis relies on/);
    assert.match(output, /to reach this conclusion\./);
  }
});

test("D12: a single-hump invented identifier with a long, ordinary-English-word prefix is caught even though it is not in any enumerated list", () => {
  const output = stripInternalImplementationTokens(
    "reconciliationOffset could not be resolved from the available evidence."
  );
  assert.doesNotMatch(output, /reconciliationOffset/i);
  assert.match(output, /could not be resolved from the available evidence\./);
});

test("D13: a bracket-wrapped, entirely novel internal token is caught by the generic bracket-shape rule with zero reliance on any list", () => {
  const output = stripInternalImplementationTokens(
    "[quuxNormalizationFlag] This figure requires additional validation."
  );
  assert.doesNotMatch(output, /\[quuxNormalizationFlag\]/);
  assert.doesNotMatch(output, /quuxNormalizationFlag/);
  assert.match(output, /This figure requires additional validation\./);
});

test("D14: real single-letter-prefixed brand names are never damaged by the generic bare-token heuristic", () => {
  const cases = [
    "eBay remains a notable player in this category.",
    "eCommerce adoption continues to accelerate in this vertical.",
    "eDiscovery workflows are central to this LegalTech segment.",
    "iPhone penetration is high among the target demographic.",
    "iPad usage patterns support this conclusion.",
    "iCloud storage integration is a common customer requirement.",
    "nCino provides cloud banking infrastructure to this segment.",
    "hCaptcha is used for bot mitigation across several vendors.",
    "mBank has expanded its digital offering in this market.",
  ];
  for (const sentence of cases) {
    const output = stripInternalImplementationTokens(sentence);
    assert.equal(output, sentence, `a real brand name in "${sentence}" must survive unchanged`);
  }
});

test("D15: real short-prefix product/OS names (macOS) survive the single-hump prefix-length rule", () => {
  const sentence = "The platform ships native clients for macOS and web.";
  assert.equal(stripInternalImplementationTokens(sentence), sentence);
});

test("D16: the small safety-net allowlist covers the one known edge case (watchOS) that would otherwise cross the prefix-length threshold", () => {
  const sentence = "A companion watchOS app is planned for a future release.";
  assert.equal(stripInternalImplementationTokens(sentence), sentence);
});

test("D17: a real company name is never damaged even when it appears alongside a genuinely suspicious invented token in the same sentence", () => {
  const output = stripInternalImplementationTokens(
    "nCino and Clio were both surfaced via quuxAdjacentPlayerHeuristic during discovery."
  );
  assert.match(output, /nCino/);
  assert.match(output, /Clio/);
  assert.doesNotMatch(output, /quuxAdjacentPlayerHeuristic/i);
});

test("D18: a citation URL containing a camelCase-shaped path segment is never mangled by either the bracket or bare heuristic", () => {
  const sentence =
    "Source: https://legaltechnews.example.com/articles/aiPoweredToolsMarketReport and https://vendor.example.com/pricingPage.";
  assert.equal(stripInternalImplementationTokens(sentence), sentence);
});

test("D19: multiple genuinely distinct never-seen-before internal tokens in one document are all removed, and the resulting prose stays coherent", () => {
  const output = stripInternalImplementationTokens(
    "The graph exposes rawEvidenceClusterId and downstreamNormalizationPass fields, " +
      "neither of which should appear in a report meant for eCommerce and eDiscovery vendors like nCino."
  );
  assert.doesNotMatch(output, /rawEvidenceClusterId/i);
  assert.doesNotMatch(output, /downstreamNormalizationPass/i);
  assert.match(output, /eCommerce/);
  assert.match(output, /eDiscovery/);
  assert.match(output, /nCino/);
});

// ===========================================================================
// E. Existing P0 #1-#7 protections remain intact (smoke checks -- the
//    authoritative regression net is the full existing suite run alongside
//    this file per the ticket's VALIDATION requirement)
// ===========================================================================

test("E1: TAM/SAM/SOM validation gating is untouched -- no evidence still yields no fabricated figures", () => {
  const evidence = [
    baseEvidence({
      claim: "General commentary with no market sizing figures at all.",
      sourceTitle: "General overview",
      publisher: "Some Site",
      url: "https://somesite.example.com/overview",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Analyze an obscure niche market.");
  assert.equal(graph.planningEstimate, null);
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.doesNotMatch(projection.tamSamSom, /\$\d/, "must never fabricate TAM/SAM/SOM without evidence");
});

test("E2: source/vendor integrity -- a single low-quality, single-domain mention still does not clear full vendor validation (existence bar unchanged by the Defect 2 fix)", () => {
  const evidence = [
    baseEvidence({
      claim: "Docketly is a leading software vendor named in an industry roundup as active in this market.",
      value: "Docketly roundup mention",
      sourceTitle: "Docketly roundup listicle",
      publisher: "legaltechroundup.example.com",
      url: "https://legaltechroundup.example.com/blog/roundup",
      searchQuery: "Docketly market roundup",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, legalTechPrompt);
  assert.equal(
    graph.vendorIntelligence.vendors.length,
    0,
    "a single low-quality mention must still never validate as a direct competitor after the Defect 2 fix"
  );
});

test("E3: the internal-token sanitizer runs downstream of sanitizeAiResponseText and does not alter its own established acronym/PMF replacements", () => {
  const output = sanitizeMarketReportContent("This report discusses ARR and PMF alongside market benchmarks.");
  assert.match(output, /annual revenue/);
  assert.match(output, /market fit/);
});
