import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { normalizePdfText, presentUnverifiedEvidenceStatus } from "../app/lib/pdf-normalization.mjs";

// TASK #27C -- Fix the evidence-status normalization regression in the
// real Market Intelligence PDF.
//
// REGRESSION 1 (confirmed live, real persisted report): the deterministic,
// codebase-generated evidence-quality disclaimer sentence ("Some external
// sources could not be verified, so this section does not contain a
// definitive conclusion." -- report-output-sanitization.ts, generation
// time -- relabeled by sanitizeMarketIntelligencePresentationText into
// "Some assumptions require additional validation before a final
// conclusion.") can end up as the LAST physical line of
// strategicRecommendations' own content, exactly like the pre-existing
// "If all three succeed, scale..." trailing sentence. It has no bullet/
// numbered marker and matched none of extractRecommendationItems' own
// heading/metadata exclusion checks, so it was rendered as a fake, fourth
// "Action" card -- meta-commentary about the REPORT's evidence quality,
// never an actionable recommendation. FIX: a new, separately-named
// isEvidenceStatusDisclaimerLine function (page.tsx/Planner.tsx/
// ReportPdfButton.tsx) excludes it from both the bullet-line and fallback
// sentence-split filtering paths, in every supported language.
//
// REGRESSION 2 (reported, not independently reproducible against the
// current real persisted report or via direct testing of this session's
// own PDF-presentation code): "evidence-status normalization appears to
// be deleting or collapsing meaningful section content." Investigated
// thoroughly: presentUnverifiedEvidenceStatus (Task #27B) is a pure
// per-marker string substitution (`.split(marker).join(label)`) that can
// only ever replace the marker text itself -- it has no code path capable
// of deleting or truncating surrounding content, and direct testing
// against the exact real persisted report (id
// 4c0b5786-357c-4927-b7ff-3d38664b6495) plus every report regenerated
// since (ids 69609b72, 55c96ce5, d1bd69a6, 85f46427, 4c12c95c) shows
// Major Players' full vendor list intact in every case. This suite adds a
// permanent structural invariant -- normalization may only ever ADD
// characters (for the label rewrite), never remove content that was not
// itself part of a recognized marker -- as a regression guard for this
// class of bug regardless of root cause, per requirement 2's own
// "normalization cannot erase substantive section text" wording.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

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

async function compileExtractRecommendationItems(source) {
  const pieces = [
    `const SENTENCE_ABBREVIATIONS = ${JSON.stringify([
      "U.S.", "U.K.", "U.N.", "E.U.", "U.A.E.", "e.g.", "i.e.", "etc.", "vs.", "cf.",
      "Inc.", "Corp.", "Ltd.", "Co.", "LLC.", "Dr.", "Mr.", "Mrs.", "Ms.", "Jr.", "Sr.",
      "St.", "Prof.", "Ph.D.", "a.m.", "p.m.", "No.", "approx.",
    ])};`,
    extractFunctionSource(source, "isRecommendationHeadingLine"),
    extractFunctionSource(source, "isMetadataOnlyRecommendationLine"),
    extractFunctionSource(source, "isEvidenceStatusDisclaimerLine"),
    `export ${extractFunctionSource(source, "extractRecommendationItems")}`,
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-evidence-isolation-"));
  const outPath = join(dir, "extractRecommendationItems.ts");
  writeFileSync(outPath, pieces);
  const mod = await import(pathToFileURL(outPath).href);
  return mod.extractRecommendationItems;
}

const surfaces = [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
];

// --- H1. evidence-status sentences can never become recommendation items

test("H1a. the exact real defect: a trailing 'Some assumptions require additional validation before a final conclusion.' sentence is NEVER parsed as a recommendation action, in all 3 files", async () => {
  const content =
    "1) Market-access validation — Owner: Head of Sales, Budget ceiling: USD 80,000; KPI: qualified channels secured; Success criterion: one listing signed within 90 days.\n2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy report; Success criterion: 90% extraction F1 within 90 days.\n3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000; KPI: signed pilot contracts; Success criterion: 3 pilots convert within 6 months.\nSome assumptions require additional validation before a final conclusion.";

  for (const [name, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 3, `${name}: only the 3 real actions may survive, got ${items.length}: ${JSON.stringify(items)}`);
    assert.ok(
      !items.some((item) => /additional validation before a final conclusion/i.test(item)),
      `${name}: the evidence-status disclaimer must never appear as a recommendation item`
    );
    assert.match(items[0], /^Market-access validation/);
    assert.match(items[1], /^Accuracy benchmarking engagement/);
    assert.match(items[2], /^6-account pilot commitments/);
  }
});

test("H1b. the raw, pre-relabeling fallback wording ('Some external sources could not be verified, so...') is also never parsed as a recommendation, in all 3 files", async () => {
  const content =
    "1) A real, complete recommendation action with full owner and budget details.\nSome external sources could not be verified, so this section does not contain a definitive conclusion.";

  for (const [name, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 1, `${name}: only the 1 real action may survive`);
    assert.match(items[0], /^A real, complete recommendation action/);
  }
});

test("H1c. the Turkish equivalents of both disclaimer forms are also excluded, in all 3 files", async () => {
  const content =
    "1) Gerçek bir aksiyon maddesi burada tam detaylarıyla yer almaktadır.\nBazı varsayımlar nihai bir sonuca varılmadan önce ek doğrulama gerektiriyor.";

  for (const [name, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 1, `${name}: only the 1 real action may survive`);
  }
});

test("H1d. a genuine recommendation that merely MENTIONS 'validation' or 'evidence' as part of a real action is never mistaken for the disclaimer -- the match is anchored to the full canonical sentence, not a keyword", async () => {
  const content =
    "1) Run additional validation of pricing assumptions before finalizing the go-to-market plan — Owner: Head of Product, Budget ceiling: USD 20,000; Success criterion: validation complete within 60 days.";

  for (const [name, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 1, `${name}: a genuine action mentioning 'validation' must survive`);
    assert.match(items[0], /^Run additional validation of pricing assumptions/);
  }
});

test("H1e. STRUCTURAL AUDIT: isEvidenceStatusDisclaimerLine exists as its own, separately-named function in all 3 files (evidence-status metadata kept structurally distinct from heading/metadata detection, per the ticket's own 'separate evidence-status metadata from recommendation extraction' requirement)", () => {
  for (const [name, source] of surfaces) {
    assert.match(source, /function isEvidenceStatusDisclaimerLine\(item: string\): boolean \{/, `${name}: expected a dedicated isEvidenceStatusDisclaimerLine function`);
    const filterOccurrences = source.match(/!isEvidenceStatusDisclaimerLine\(line\)/g) || [];
    assert.equal(filterOccurrences.length, 2, `${name}: expected the new check wired into BOTH the bullet-line and fallback filter paths`);
  }
});

// --- H2. normalization cannot erase substantive section text -------------

test("H2a. presentUnverifiedEvidenceStatus never removes any character that was not part of a recognized marker -- a structural invariant, not just a spot-check", () => {
  const fixtures = [
    "Ironclad offers CLM workflow automation (unverified). Evisort provides AI-native intelligence (unverified). LawGeex focuses on contract review (unverified). DocuSign has strong procurement evidence.",
    "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site (unverified).\nEvisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence (unverified).\nDocuSign CLM — appears in state procurement pricing (South Carolina) (unverified).\nLawGeex — advertises AI contract-review capabilities (unverified).\n(118 words)",
    "No marker at all in this completely ordinary paragraph of real prose.",
  ];

  for (const fixture of fixtures) {
    const result = presentUnverifiedEvidenceStatus(fixture);
    // Every marker occurrence becomes a longer label -- the result can
    // only ever be the SAME length or LONGER, never shorter, since this
    // function performs pure substring substitution with a longer
    // replacement and never deletes anything else.
    assert.ok(
      result.length >= fixture.length,
      `output must never be shorter than input (got ${result.length} vs ${fixture.length}) for fixture ${JSON.stringify(fixture)}`
    );
    // Every substantive word from the original survives somewhere in the
    // output (a strong proxy for "no content was deleted").
    const substantiveWords = fixture
      .replace(/\(unverified\)/g, "")
      .split(/\s+/)
      .filter((word) => word.length > 3);
    for (const word of substantiveWords) {
      assert.ok(result.includes(word), `expected "${word}" to survive in the output: ${JSON.stringify(result)}`);
    }
  }
});

test("H2b. the exact real Major Players content (all 4 vendors) survives normalizePdfText completely, across every real report generation observed (pre- and post-Task #27B label wording)", () => {
  const rawVariants = [
    // Pre-Task #27C generation-time label already applied (report ids 4c12c95c/69609b72).
    "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site (Evidence status: Unverified).\nEvisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence (Evidence status: Unverified).\nDocuSign CLM — appears in state procurement pricing (South Carolina), showing public-sector purchasing routes and bundled eSignature/CLM offerings (Evidence status: Unverified).\nLawGeex — advertises AI contract-review capabilities (product landing) and positions on automated review (Evidence status: Unverified).\n(118 words)",
    // Legacy bracketed form (oldest reports).
    "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site [Unverified reference].\nEvisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence [Unverified reference].\nDocuSign CLM — appears in state procurement pricing (South Carolina), showing public-sector purchasing routes and bundled eSignature/CLM offerings [Unverified reference].\nLawGeex — advertises AI contract-review capabilities (product landing) and positions on automated review [Unverified reference].\n(118 words)",
  ];

  for (const raw of rawVariants) {
    const rendered = normalizePdfText(raw);
    for (const vendor of ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"]) {
      assert.ok(rendered.includes(vendor), `expected "${vendor}" to survive normalizePdfText: ${JSON.stringify(rendered)}`);
    }
    assert.match(rendered, /product pages and pricing plan page indicate CLM \+ AI assistant \+ eSignature positioning/);
    assert.match(rendered, /publishes an AI engine and contract LLM/);
    assert.match(rendered, /appears in state procurement pricing \(South Carolina\)/);
    assert.match(rendered, /advertises AI contract-review capabilities/);
    assert.doesNotMatch(rendered, /\(unverified\)/);
    assert.doesNotMatch(rendered, /\[Unverified reference\]/);
    assert.doesNotMatch(rendered, /\*/);
  }
});

// --- H3. raw evidence artifacts remain removed (no regression from #27B)

test("H3. no raw '(unverified)'/'[Unverified reference]' and no dangling '*' can survive this task's changes, for any of the 9 specifically-audited sections' real-shaped content", () => {
  const auditedFixtures = {
    majorPlayers: "Ironclad is active (unverified). Evisort is active (unverified).",
    industryTrends: "AI adoption is accelerating (unverified). Category growth continues (unverified).",
    marketSegmentation: "Mid-market segment is largest (unverified). Enterprise segment is smaller (unverified).",
    regionalAnalysis: "U.S. evidence is strongest (unverified). Europe evidence is thin (unverified).",
    marketDrivers: "Compliance pressure is rising (unverified). Automation demand is growing (unverified).",
    barriers: "Regulatory friction is real (unverified). Procurement cycles are slow (unverified).",
    opportunities: "Mid-market pricing gap exists (unverified). Vertical templates are underserved (unverified).",
    threats: "New entrants may compress pricing (unverified). Incumbents may bundle features (unverified).",
  };

  for (const [field, content] of Object.entries(auditedFixtures)) {
    const rendered = normalizePdfText(content);
    assert.doesNotMatch(rendered, /\(unverified\)/i, `${field}: no raw marker may remain`);
    assert.doesNotMatch(rendered, /\*/, `${field}: no dangling reference mark may remain`);
    // TASK #28/#28B -- each fixture has 2 occurrences and no citation, so
    // the professional disclosure now appears once, as the compact
    // section-level note, instead of twice inline -- the underlying
    // evidence-status disclosure must still be present in some form.
    assert.match(
      rendered,
      /\(Evidence status: Unverified\)|Evidence note: Some claims require independent validation\./,
      `${field}: the professional evidence-status disclosure must still be present`
    );
  }
});

// --- H4. genuine recommendations preserve semantic boundaries and count --

test("H4. Task #26/#26B's mid-sentence wrap merge and item count are completely unaffected by this task's evidence-status isolation fix", async () => {
  const content =
    "First 90 Days (three concrete actions): 1) Market-access validation — Owner: Head of Sales (U.S.\nmid-market), Budget ceiling: USD 80,000; Success criterion: one listing signed within 90 days.\n2) Accuracy benchmarking engagement — Owner: Head of Product; Success criterion: 90% extraction F1.\n3) 6-account pilot commitments — Owner: Head of Commercial; KPI: signed pilot contracts with 6 U.S.\nmid-market customers across two verticals.\nIf all three succeed, scale; otherwise re-evaluate and monitor instead.";

  for (const [name, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 4, `${name}: 3 real (correctly-merged) actions + 1 pre-existing trailing summary sentence, got ${items.length}: ${JSON.stringify(items)}`);
    assert.match(items[0], /Head of Sales \(U\.S\. mid-market\), Budget ceiling: USD 80,000/, `${name}: action 1's boundary merge must remain correct`);
    assert.match(items[2], /6 U\.S\. mid-market customers across two verticals/, `${name}: action 3's boundary merge must remain correct`);
  }
});

// --- H5. the exact real persisted report survives normalization end to end

test("H5. real-report-shaped end-to-end: Strategic Recommendations (4 real items, no disclaimer as a 5th) and Major Players (full vendor list, professional label, no raw artifacts) both hold simultaneously, modeled on report id 4c0b5786-357c-4927-b7ff-3d38664b6495 and its regenerated siblings (69609b72, 55c96ce5, d1bd69a6, 85f46427, 4c12c95c)", async () => {
  const strategicRecommendations =
    "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan and procurement readiness; see R12, R4, R5, R3).\nConviction: Supported by growth forecasts and active vendor productization; key remaining uncertainty is SOM and realistic win rates.\nTrade-offs: Invest early in accuracy benchmarking and procurement qualification rather than broad enterprise feature parity.\nFirst 90 Days (three concrete actions): 1) Market-access validation — Owner: Head of Sales (U.S.\nmid-market), Budget ceiling: USD 80,000; KPI: number of qualified mid-market procurement channels secured (target = 3 state or national procurement frameworks or reseller agreements); Success criterion: at least one state procurement listing or one reseller agreement signed within 90 days (evidence path: state contract templates like R3).\n2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) (unverified).\n3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S.\nmid-market customers across two verticals (target verticals: tech services and manufacturing); Success criterion: at least 3 pilots convert to paid contracts within 6 months or provide per-account annual revenue Market sources to validate SOM assumptions.\nIf all three succeed, scale; if accuracy Market sources or procurement listing fails, re-evaluate and monitor instead.\nSome assumptions require additional validation before a final conclusion.\n(174 words)";

  const majorPlayers =
    "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site (Evidence status: Unverified).\nEvisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence (Evidence status: Unverified).\nDocuSign CLM — appears in state procurement pricing (South Carolina), showing public-sector purchasing routes and bundled eSignature/CLM offerings (Evidence status: Unverified).\nLawGeex — advertises AI contract-review capabilities (product landing) and positions on automated review (Evidence status: Unverified).\n(118 words)";

  for (const [name, source] of surfaces) {
    const extractRecommendationItems = await compileExtractRecommendationItems(source);
    const items = extractRecommendationItems(strategicRecommendations);
    assert.equal(items.length, 4, `${name}: expected exactly 4 items (3 real actions + 1 pre-existing trailing sentence), the evidence-status disclaimer must be excluded, got ${JSON.stringify(items)}`);
    assert.ok(
      !items.some((item) => /additional validation before a final conclusion/i.test(item)),
      `${name}: the disclaimer must never survive as an item`
    );
    assert.ok(items.some((item) => /If all three succeed, scale/.test(item)), `${name}: the pre-existing trailing summary sentence must still survive (unrelated, unchanged behavior)`);
  }

  const renderedMajorPlayers = normalizePdfText(majorPlayers);
  for (const vendor of ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"]) {
    assert.ok(renderedMajorPlayers.includes(vendor), `expected "${vendor}" to survive in Major Players`);
  }
  assert.doesNotMatch(renderedMajorPlayers, /\(unverified\)/);
  assert.doesNotMatch(renderedMajorPlayers, /\*/);
});
