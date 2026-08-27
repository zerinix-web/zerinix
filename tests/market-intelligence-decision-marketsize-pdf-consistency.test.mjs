import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveMarketIntelligenceExecutiveDecision } from "../app/lib/report-engine/executive-decision-vocabulary.ts";
import { getSectionTakeaway, stripLeadingTakeawaySentence } from "../app/lib/report-presentation.ts";
import {
  buildMarketIntelligenceGraph,
  projectMarketIntelligenceGraphToReport,
} from "../app/lib/ai/market-intelligence-graph.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pdfSource = readFileSync(`${repoRoot}app/dashboard/[id]/ReportPdfButton.tsx`, "utf8");
const pageSource = readFileSync(`${repoRoot}app/dashboard/[id]/page.tsx`, "utf8");

// P0 PRODUCTION HARDENING PASS -- root-cause fixes for six remaining
// Market Intelligence production consistency defects:
//
// 1. EXECUTIVE DECISION/CONFIDENCE: a real production executiveSummary
//    contained only the model's own free-text "Bottom Line — Decision:
//    MONITOR market entry for U.S." sentence -- the deterministic
//    banner (formatExecutiveDecisionBrief) was genuinely absent.
//    extractExecutiveDecisionFromText correctly declined this shape
//    (line-start label anchor, strict trailing-boundary guard -- both
//    deliberate, load-bearing against a documented false-positive
//    class), and the raw-label fallback ALSO required the label at
//    line-start, missing this text entirely -- so the canonical
//    resolver returned "—" for both Decision and Confidence despite a
//    real, valid decision existing. An initial attempt added a new
//    "labeled-token" tier that collapsed the match down to just the
//    clean vocabulary token (e.g. "MONITOR") -- reverted, because it
//    reintroduced exactly the documented false-positive class an
//    existing regression test guards against ("Decision: Monitor for a
//    staged U.S. entry, contingent on validating TAM/SAM assumptions
//    ..." uses "Monitor" as an ordinary verb, not a categorical token,
//    and collapsing it to "MONITOR" would discard the real qualifying
//    clause). The correct, minimal fix instead widens the EXISTING
//    raw-label tier's label-position requirement from "line-start only"
//    to "anywhere, word-boundary-delimited" -- it still returns the
//    full text verbatim, never remapped to a clean token, so both the
//    ticket's new shape and the historical guard case resolve exactly
//    as their own designs intend.
//
// 2. MARKET SIZE DISAPPEARS FROM PDF: the genuine "Market Size" section
//    (field === "marketSize") was misclassified as a "legacy TAM/SAM/SOM
//    duplicate" by isLegacyTamSamSomSection's title regex
//    (`\bmarket\s+size\b` matches the section's OWN title) and by
//    normalizeSavedPdfSectionsBeforeRender's contentContainsSizingInsight
//    (trivially satisfied by the section's own title containing "market
//    size"), silently dropping a valid, populated section from the PDF
//    entirely. Fixed by excluding field === "marketSize" from both
//    checks, mirroring the existing guard already protecting the
//    canonical tamSamSom field.
//
// 5. PDF DUPLICATE CONTENT (third root cause): getSectionTakeaway's own
//    sentence source (splitSentences) filters out any sentence <=24
//    characters after markdown-stripping -- a short punchy opening
//    verdict the report's own style guidance explicitly instructs the
//    model to write first is routinely exactly this short, so the
//    takeaway can legitimately be the SECOND (or later) real sentence,
//    still on the same first line/bullet. Every prior fix only ever
//    tested ONE candidate span against the takeaway, so this shape
//    always survived untouched. Rewrote stripLeadingTakeawaySentence to
//    scan every successive sentence boundary within the search window
//    and remove whichever one actually matches, preserving every
//    sentence before and after it -- generic, no longer dependent on
//    which sentence position getSectionTakeaway happened to pick.
//
// 6. PDF COVER NEXT ACTION MALFORMED: "Immediate Next Action" is the
//    deterministic banner's own label, never present in the market
//    executiveSummary prompt (which instead always instructs a scoped
//    "(5) Recommendation" bullet list). When the banner is absent, this
//    extraction always returned "", forcing a fallback to
//    buildExecutiveSnapshot's nextAction -- an UNSCOPED, keyword-based
//    full-report scan with no section boundary, producing the reported
//    malformed "combined AUM$150M) to validate attainable..." fragment
//    lifted from an unrelated section. Fixed by falling back to the
//    model's own scoped "Recommendation"/"Biggest Risk" sections
//    (still confined to the executiveSummary content) before ever
//    reaching the unscoped full-report fallback.

// ===========================================================================
// 1. Executive Decision / Confidence propagation
// ===========================================================================

test("DECISION1: the exact reported production shape -- 'Bottom Line — Decision: MONITOR market entry for U.S. ...' -- now resolves to a real, honest raw-label decision (verbatim text, never collapsed to a bare token) instead of '—'", () => {
  const executiveSummary =
    "Bottom Line — Decision: MONITOR market entry for U.S. property management services given thin competitive validation and unresolved TAM scope.\n\nKey Findings:\n- Finding one.\n- Finding two.";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.equal(result.decisionSource, "raw-label");
  assert.match(result.decisionLabel, /^MONITOR market entry for U\.S\./);
  assert.notEqual(result.decisionLabel, "—", "a real decision must never render as unavailable when the model plainly stated one");
  assert.equal(result.confidenceScore, null, "confidence must stay honestly unavailable, never fabricated from a shape with no structured confidence figure");
});

test("DECISION2 (no evidence-standard weakening, regression guard): the historical false-positive shape ('Decision: Monitor for a staged U.S. entry, contingent on validating TAM/SAM assumptions...', where 'Monitor' is an ordinary verb, not a categorical token) must still return the FULL qualifying text verbatim, never collapsed to just 'MONITOR' and never remapped to a canonical enum", () => {
  const executiveSummary =
    "Bottom Line: A cautious, staged entry is warranted while key sizing evidence remains unverified.\n\nDecision: Monitor for a staged U.S. entry, contingent on validating TAM/SAM assumptions and observing early pilot signal before any broader commitment.";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.equal(result.decisionSource, "raw-label");
  assert.match(result.decisionLabel, /Monitor for a staged U\.S\./);
  assert.doesNotMatch(result.decisionLabel.toUpperCase(), /^MONITOR$/, "must never collapse the rich qualifying clause down to a bare token");
  assert.equal(result.canonicalDecision, null, "a raw-label decision has no reliable enum mapping and must never be guessed");
  assert.equal(result.confidenceScore, null);
});

test("DECISION3 (no evidence-standard weakening, regression guard): text with no 'Decision:'/'Karar:' label anywhere still correctly resolves to unavailable, never guessing a decision from unrelated prose", () => {
  const executiveSummary =
    "Vendors should closely track competitor pricing. We recommend further due diligence before committing capital, given thin evidence.";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.equal(result.decisionSource, "unavailable");
  assert.equal(result.decisionLabel, "—");
  assert.equal(result.confidenceScore, null);
});

test("DECISION4 (no regression): the deterministic canonical banner (Tier 1) still takes priority and still safely extracts real confidence when it IS present", () => {
  const executiveSummary = "Decision: MONITOR (Confidence: 58%)\n\nWhy: Evidence is directionally supportive but incomplete.";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.equal(result.decisionSource, "canonical-banner");
  assert.equal(result.confidenceScore, 58);
});

test("DECISION5 (no regression): an action-shaped next-step sentence following the label is still correctly rejected, never mistaken for the decision verdict", () => {
  const executiveSummary = "Decision: Commission a $50k primary demand study before committing further resources.";
  const result = resolveMarketIntelligenceExecutiveDecision(executiveSummary, "English");
  assert.equal(result.decisionSource, "unavailable");
  assert.equal(result.decisionLabel, "—");
});

// ===========================================================================
// 2. Market Size PDF section survival
// ===========================================================================

function extractPdfFn(name) {
  const idx = pdfSource.indexOf(`function ${name}`);
  const parenStart = pdfSource.indexOf("(", idx);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < pdfSource.length; i++) {
    if (pdfSource[i] === "(") parenDepth++;
    else if (pdfSource[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  const braceStart = pdfSource.indexOf("{", parenEnd);
  let depth = 0;
  for (let i = braceStart; i < pdfSource.length; i++) {
    if (pdfSource[i] === "{") depth++;
    else if (pdfSource[i] === "}") {
      depth--;
      if (depth === 0) return pdfSource.slice(idx, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function stripParamTypes(src) {
  const parenStart = src.indexOf("(");
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < src.length; i++) {
    if (src[i] === "(") parenDepth++;
    else if (src[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  const sig = src.slice(0, parenEnd + 1);
  const rest = src.slice(parenEnd + 1);
  const nameOnly = sig
    .replace(/<[^<>]*>/g, "")
    .replace(/:\s*\{[^{}]*\}/g, "")
    .replace(/:\s*string(\[\])?/g, "")
    .replace(/:\s*T\[\]/g, "")
    .replace(/\?\s*(?=[,)])/g, "");
  return nameOnly + rest;
}

const isTamSamSomTitleFn = extractPdfFn("isTamSamSomTitle");
const normalizePdfTextStub = "function normalizePdfText(v) { return v; }";

function compileIsLegacyTamSamSomSection() {
  const isLegacyFn = extractPdfFn("isLegacyTamSamSomSection");
  const bundle = `${normalizePdfTextStub}\n${stripParamTypes(isTamSamSomTitleFn)}\n${stripParamTypes(isLegacyFn)}`;
  return new Function(`${bundle}\nreturn isLegacyTamSamSomSection;`)();
}

function compileNormalizeSavedPdfSections() {
  const fn = extractPdfFn("normalizeSavedPdfSectionsBeforeRender");
  const bundle = `${normalizePdfTextStub}\n${stripParamTypes(isTamSamSomTitleFn)}\n${stripParamTypes(fn)}`;
  return new Function(`${bundle}\nreturn normalizeSavedPdfSectionsBeforeRender;`)();
}

test("MARKETSIZE1: isLegacyTamSamSomSection no longer misclassifies the genuine Market Size section (field='marketSize') as a legacy TAM/SAM/SOM duplicate", () => {
  const isLegacy = compileIsLegacyTamSamSomSection();
  assert.equal(
    isLegacy({
      field: "marketSize",
      title: "Market Size",
      content: "Market Size\n$131.6 billion\n[Verified] $131.6B industry baseline.",
    }),
    false
  );
});

test("MARKETSIZE2: isLegacyTamSamSomSection still correctly identifies a genuine legacy duplicate (no field, or a title clearly about TAM/SAM/SOM sizing, not the Market Size field itself)", () => {
  const isLegacy = compileIsLegacyTamSamSomSection();
  assert.equal(
    isLegacy({
      field: undefined,
      title: "Market Sizing Overview",
      content: "some stray legacy content",
    }),
    true
  );
});

test("MARKETSIZE3: the Market Size section survives even when its content includes the report's standard 'AI Executive Insight' callout (previously the specific trigger for the second, independent drop)", () => {
  const isLegacy = compileIsLegacyTamSamSomSection();
  assert.equal(
    isLegacy({
      field: "marketSize",
      title: "Market Size",
      content: "AI Executive Insight: this is a $131.6B verified market size baseline for the U.S. property-management sector.",
    }),
    false
  );
});

test("MARKETSIZE4: normalizeSavedPdfSectionsBeforeRender no longer drops the genuine Market Size section when a TAM/SAM/SOM section also exists and Market Size contains an 'AI Executive Insight' callout", () => {
  const normalize = compileNormalizeSavedPdfSections();
  const sections = [
    { field: "tamSamSom", title: "TAM / SAM / SOM", content: "TAM: Validation Needed\nSAM: Pending TAM Validation\nSOM: Pending SAM Validation" },
    { field: "marketSize", title: "Market Size", content: "AI Executive Insight: this is a $131.6B verified market size baseline for the U.S. property-management sector." },
    { field: "cagr", title: "CAGR", content: "AI Executive Insight: CAGR is 4.2%." },
  ];
  const result = normalize(sections);
  assert.ok(result.some((s) => s.field === "marketSize"), "Market Size must survive normalization");
});

test("MARKETSIZE5 (no regression): the canonical tamSamSom section itself is still deduplicated correctly when duplicated", () => {
  const normalize = compileNormalizeSavedPdfSections();
  const sections = [
    { field: "tamSamSom", title: "TAM / SAM / SOM", content: "TAM: $10B\nSAM: $2B\nSOM: $500M" },
    { field: undefined, title: "TAM / SAM / SOM (legacy)", content: "duplicate legacy TAM/SAM/SOM content" },
  ];
  const result = normalize(sections);
  assert.equal(result.filter((s) => s.field === "tamSamSom" || /tam.*sam.*som/i.test(s.title)).length, 1);
});

// ===========================================================================
// 3. Competitive Landscape vs Major Players -- confirm the existing honest
//    third-tier fallback correctly fires for the exact reported scenario
// ===========================================================================

function extractPageFn(name) {
  const idx = pageSource.indexOf(`function ${name}`);
  const parenStart = pageSource.indexOf("(", idx);
  let parenDepth = 0;
  let parenEnd = -1;
  for (let i = parenStart; i < pageSource.length; i++) {
    if (pageSource[i] === "(") parenDepth++;
    else if (pageSource[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        parenEnd = i;
        break;
      }
    }
  }
  const braceStart = pageSource.indexOf("{", parenEnd);
  let depth = 0;
  for (let i = braceStart; i < pageSource.length; i++) {
    if (pageSource[i] === "{") depth++;
    else if (pageSource[i] === "}") {
      depth--;
      if (depth === 0) return pageSource.slice(idx, i + 1);
    }
  }
  throw new Error(`unbalanced braces extracting ${name}`);
}

function compileNamesOnly() {
  const isImplausibleFn = extractPageFn("isImplausibleCompetitorNameOnScreen");
  const namesOnlyFn = extractPageFn("extractMarketIntelligenceCompetitorNamesOnly");
  const strip = (src) => src.replace(/:\s*string\[\]/g, "").replace(/:\s*string/g, "");
  const bundle = `${strip(isImplausibleFn)}\n${strip(namesOnlyFn)}`;
  return new Function(`${bundle}\nreturn extractMarketIntelligenceCompetitorNamesOnly;`)();
}

test("COMPLANDSCAPE1: the exact reported scenario -- Major Players names CBRE, JLL, and Cushman & Wakefield as adjacent (not directly validated) players -- extracts all three real names for the honest third-tier fallback, so Competitive Landscape can never claim no data exists", () => {
  const namesOnly = compileNamesOnly();
  const majorPlayersContent = [
    "Relevant Industry Players — Not Independently Validated as Direct Competitors",
    "These companies are named in available evidence as active in or adjacent to this market, but current evidence does not independently corroborate them as directly comparable competitors. See Competitive Landscape for direct-competitor validation status.",
    "- CBRE: CBRE is a commercial product vendor with evidence directly tied to the requested market. Evidence is directional: named in research without independently verified sourcing. (confidence: 36/100 Low) — Not independently validated as a direct competitor from current evidence.",
    "- JLL: JLL is a commercial product vendor with evidence directly tied to the requested market. Evidence is directional: named in research without independently verified sourcing. (confidence: 36/100 Low) — Not independently validated as a direct competitor from current evidence.",
    "- Cushman & Wakefield: Cushman & Wakefield is a commercial product vendor with evidence directly tied to the requested market. (confidence: 40/100 Low) — Not independently validated as a direct competitor from current evidence.",
  ].join("\n");
  const names = namesOnly(majorPlayersContent);
  assert.deepEqual(names.sort(), ["CBRE", "Cushman & Wakefield", "JLL"].sort());
});

test("COMPLANDSCAPE2 (no regression): genuinely empty Major Players content yields zero names, so the honest flat 'no data' message remains available for the genuinely-empty case", () => {
  const namesOnly = compileNamesOnly();
  assert.deepEqual(namesOnly(""), []);
  assert.deepEqual(namesOnly("Insufficient independent evidence for Major Players ranking."), []);
});

// ===========================================================================
// 4. TAM/SAM/SOM never auto-derived from a verified Market Size baseline
// ===========================================================================

const checkedAt = "2026-08-27T00:00:00.000Z";
let idCounter = 0;
function nextId() {
  idCounter += 1;
  return `PC${idCounter}`;
}
function officialMarketSizeEvidence(overrides) {
  return {
    id: nextId(),
    field: "market_size",
    claim: "",
    value: "",
    label: "Verified from official source",
    sourceTitle: "",
    publisher: "",
    url: "",
    sourceType: "official_statistics",
    authorityLevel: "primary",
    confidence: 90,
    publishedDate: "2026-01-10",
    lastChecked: checkedAt,
    supportingData: [],
    impact: "neutral",
    impactReason: "Supports verified market size.",
    qualityScore: 92,
    qualityRationale: "Primary government statistics.",
    searchQuery: "",
    ...overrides,
  };
}

test("TAMPROPAGATION1 (no regression, no evidence-standard weakening): a verified $131.6B Market Size baseline never overwrites/populates tamSamSom -- it is deliberately left to the model's own, independently-validated derivation", () => {
  const evidence = [
    officialMarketSizeEvidence({
      claim: "The U.S. commercial real estate services market size was $131.6 billion in 2024, per Census Bureau statistics.",
      value: "$131.6 billion",
      sourceTitle: "U.S. Census Bureau Services Annual Survey",
      publisher: "U.S. Census Bureau",
      url: "https://www.census.gov/cre-services",
    }),
  ];
  const graph = buildMarketIntelligenceGraph({ evidence }, "Evaluate the mature U.S. commercial real estate services market for a boutique brokerage.");
  assert.ok(graph.verifiedMarketSize.length > 0);
  // tamSamSom is untouched by the verified-market-size branch (see
  // market-intelligence-graph.ts's own comment) -- it must never equal
  // the raw marketSize sizing line.
  const projection = projectMarketIntelligenceGraphToReport(graph, "English");
  assert.notEqual(projection.tamSamSom, projection.marketSize);
});

// ===========================================================================
// 5. PDF duplicate content -- the third root cause (short-sentence filter
//    mismatch between getSectionTakeaway and stripLeadingTakeawaySentence)
// ===========================================================================

test("DUPFIX3-1: the newly-diagnosed shape -- a bulleted item whose own short (<=24 char) opening sentence is filtered out by splitSentences, making the takeaway the SECOND sentence on the same line -- is now correctly deduplicated while the short opening sentence survives intact", () => {
  const content =
    "1. **Regulatory tailwinds.** Rising demand for compliance automation across the U.S. and E.U. is accelerating adoption of AI-driven audit tools among mid-market financial services firms with cross-border obligations.\n2. **Cloud migration.** Enterprises are consolidating legacy on-prem audit systems onto cloud-native platforms, creating a large addressable upgrade market for compliance vendors.";
  const takeaway = getSectionTakeaway(content);
  assert.match(takeaway, /Rising demand for compliance automation/);

  const stripped = stripLeadingTakeawaySentence(content, takeaway);
  assert.ok(!stripped.includes("Rising demand for compliance automation"));
  assert.match(stripped, /\*\*Regulatory tailwinds\.\*\*/, "the short opening sentence must survive with its closing bold marker intact");
  assert.match(stripped, /Cloud migration/);
});

test("DUPFIX3-2 (no regression): all three previously-fixed shapes (whole-bullet duplicate, bold-colon bullet, label-only-line-plus-continuation) still dedupe correctly after the rewrite", () => {
  const a = "1) Integration-first add-on products are becoming standard.\n2) Pricing bundles are consolidating across major vendors.";
  const strippedA = stripLeadingTakeawaySentence(a, getSectionTakeaway(a));
  assert.ok(!strippedA.includes("Integration-first add-on products"));
  assert.match(strippedA, /Pricing bundles/);

  const b =
    "1. **Regulatory tailwinds**: Rising compliance requirements are pushing adoption across major metros.\n2. **Cost pressure**: Operating margins are tightening amid rising insurance costs.";
  const strippedB = stripLeadingTakeawaySentence(b, getSectionTakeaway(b));
  assert.ok(!strippedB.includes("Regulatory tailwinds"));
  assert.match(strippedB, /Cost pressure/);

  const c =
    "**Answer:**\nVendors are bundling integration services with core platform offerings.\n\nAdditional detail follows.";
  const strippedC = stripLeadingTakeawaySentence(c, getSectionTakeaway(c));
  assert.ok(!strippedC.includes("Vendors are bundling integration services"));
  assert.match(strippedC, /Additional detail follows/);
});

test("DUPFIX3-3 (no regression, evidence-integrity guard): a genuinely non-duplicate first sentence/bullet is left completely unchanged", () => {
  const content =
    "1. **Regulatory tailwinds.** Rising demand for compliance automation is accelerating adoption of AI-driven audit tools.\n2. **Cloud migration.** Enterprises are consolidating legacy systems onto cloud-native platforms.";
  const unrelatedTakeaway = "This is a completely unrelated takeaway sentence that never appears anywhere in this body text.";
  const stripped = stripLeadingTakeawaySentence(content, unrelatedTakeaway);
  assert.equal(stripped, content);
});

// ===========================================================================
// 6. PDF cover Next Action / Main Risk -- no unscoped fragment extraction
// ===========================================================================

test("NEXTACTION1: source drift check -- marketNextAction now falls back to the model's own scoped 'Recommendation' section before ever reaching the unscoped full-report buildExecutiveSnapshot fallback", () => {
  assert.match(
    pdfSource,
    /extractMetricValue\(marketExecutiveSummaryContent, "Immediate Next Action"\) \|\|\s*\n\s*takeFirstListItemOrSentence\(/,
    "marketNextAction must try the scoped Recommendation fallback before falling through to the unscoped executiveSnapshot.nextAction"
  );
  assert.match(pdfSource, /"Recommendation",\s*\n\s*"Öneri",/, "the Recommendation fallback must include localized label variants");
});

test("NEXTACTION2: source drift check -- marketTopRisks (feeding Main Risk) now falls back to the model's own scoped 'Biggest Risk' sentence before the same unscoped fallback would otherwise be needed", () => {
  assert.match(pdfSource, /const biggestRisk = extractMetricValueFromAliases\(marketExecutiveSummaryContent, \[\s*\n\s*"Biggest Risk",/);
});

test("NEXTACTION3: takeFirstListItemOrSentence correctly extracts just the first item from a bulleted Recommendation block, never concatenating multiple bullets into one run-on cover fragment", () => {
  const fnSource = stripParamTypes(extractPdfFn("takeFirstListItemOrSentence")).replace(/\): string \{/, ") {");
  const mod = new Function(`${fnSource}\nreturn takeFirstListItemOrSentence;`)();
  assert.equal(
    mod("1. Commission a targeted demand study in the top 3 metros.\n2. Validate pricing with 5 prospective customers.\n3. Reassess after 90 days."),
    "Commission a targeted demand study in the top 3 metros."
  );
  assert.equal(mod("A single-sentence value with no list markers at all."), "A single-sentence value with no list markers at all.");
  assert.equal(mod(""), "");
});

test("NEXTACTION4 (no regression): the deterministic banner's own 'Immediate Next Action'/'Top 3 Risks' labels still take priority over the new scoped fallback when present", () => {
  assert.match(pdfSource, /extractMetricValue\(marketExecutiveSummaryContent, "Immediate Next Action"\)/);
  assert.match(pdfSource, /"Top 3 Risks",/);
});
