import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SENTENCE_ABBREVIATIONS } from "../app/lib/report-presentation.ts";

// TASK #18 -- Fix malformed Strategic Recommendations / First 90 Days
// action parsing.
//
// A REAL Market Intelligence report showed several correct action cards
// followed by a malformed one:
//
//   "ACTION 6
//   (174 words)"
//
// ROOT CAUSE (two independent defects in extractRecommendationItems /
// isRecommendationHeadingLine, present since before Tasks #17/#17B):
//
// 1. LOST ACTION: the real strategicRecommendations content wrote "First
//    90 Days (three concrete actions): 1) Market-access validation --
//    Owner: Head of Sales ...[R3]." as ONE physical line -- the heading
//    and its own first numbered action sharing a line, with items 2 and
//    3 each correctly on their own separate lines. isRecommendationHeadingLine's
//    line-level check correctly identifies the line as heading-shaped
//    (it starts with "First 90 Days"), but then the WHOLE line is
//    discarded -- silently losing the real first action along with the
//    heading label it happened to share a line with.
//
// 2. MALFORMED CARD: every Market Intelligence field prompt ends with
//    "Max N words," which the model echoes back as a trailing self-check
//    footnote ("(174 words)"). This line is long enough (>8 chars) and
//    doesn't match any heading pattern, so it passed straight through
//    and became "ACTION 6" -- an empty-looking, content-free card.
//
// FIX (mirrored across page.tsx, Planner.tsx, and ReportPdfButton.tsx):
//
// 1. extractRecommendationItems now inserts a real line break before any
//    numbered list marker ("1)", "2.", ...) that immediately follows a
//    ":"/"." boundary, BEFORE line-splitting runs -- so a heading and its
//    own embedded first action are always evaluated as separate lines,
//    regardless of which physical line they originally shared. Requiring
//    the marker to follow list/sentence punctuation (not just any digit)
//    keeps this safe against decimals ("3.2% market share") and citation
//    parentheticals ("like R3)").
// 2. A new isMetadataOnlyRecommendationLine helper rejects a line that is
//    ENTIRELY a word-count footnote ("(174 words)", "(Total 136
//    words)", "116 words"), anchored start-to-end so a real sentence
//    that happens to mention a word count mid-thought is never rejected.
//    Applied to both the bulleted-line tier and the sentence-split
//    fallback tier.

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
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

async function compileExtractors(source) {
  const dir = mkdtempSync(join(tmpdir(), "zerinix-action-parsing-"));
  const outPath = join(dir, "extract.mts");
  const harness = `
const SENTENCE_ABBREVIATIONS = ${JSON.stringify(SENTENCE_ABBREVIATIONS)};

${extractFunctionSource(source, "isRecommendationHeadingLine")}

${extractFunctionSource(source, "isMetadataOnlyRecommendationLine")}

${extractFunctionSource(source, "extractRecommendationItems")}

export { extractRecommendationItems, isMetadataOnlyRecommendationLine };
`;
  writeFileSync(outPath, harness);
  const mod = await import(pathToFileURL(outPath).href);
  return mod;
}

const surfaces = [
  { label: "page.tsx", source: pageSource },
  { label: "ReportPdfButton.tsx", source: pdfButtonSource },
  { label: "Planner.tsx", source: plannerSource },
];

// The EXACT real content shape (report id cdb2b520-25a5-4b5c-b125-9fad3341df20)
// that reproduced this defect live, including the trailing "(174 words)"
// self-check footnote.
const realStrategicRecommendationsContent =
  "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan and procurement readiness; see R12, R4, R5, R3).\n" +
  "Conviction: Supported by growth forecasts and active vendor productization; key remaining uncertainty is SOM and realistic win rates.\n" +
  "Trade-offs: Invest early in accuracy benchmarking and procurement qualification rather than broad enterprise feature parity.\n" +
  "First 90 Days (three concrete actions): 1) Market-access validation — Owner: Head of Sales (U.S. mid-market), Budget ceiling: USD 80,000; KPI: number of qualified mid-market procurement channels secured (target = 3 state or national procurement frameworks or reseller agreements); Success criterion: at least one state procurement listing or one reseller agreement signed within 90 days (evidence path: state contract templates like R3).\n" +
  "2) Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) [R5][R6].\n" +
  "3) 6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S. mid-market customers across two verticals (target verticals: tech services and manufacturing); Success criterion: at least 3 pilots convert to paid contracts within 6 months or provide per-account annual revenue Market sources to validate SOM assumptions.\n" +
  "If all three succeed, scale; if accuracy Market sources or procurement listing fails, re-evaluate and monitor instead.\n" +
  "(174 words)";

test("EXACT REAL FAILURE SHAPE: the real report's content no longer produces a malformed '(174 words)' card, and the first First-90-Days action (previously swallowed by the heading) is recovered, in all three surfaces", async () => {
  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(realStrategicRecommendationsContent);

    for (const item of items) {
      assert.doesNotMatch(item, /^\(?\s*\d+\s*words?\s*\)?\.?$/i, `${label}: no item may be a bare word-count footnote, got ${JSON.stringify(item)}`);
    }
    assert.ok(
      items.some((item) => item.includes("Market-access validation")),
      `${label}: expected the previously-swallowed first action to be recovered, got ${JSON.stringify(items)}`
    );
    assert.ok(
      items.some((item) => item.includes("Accuracy benchmarking engagement")),
      `${label}: expected the second action to still be present`
    );
    assert.ok(
      items.some((item) => item.includes("6-account pilot commitments")),
      `${label}: expected the third action to still be present`
    );
  }
});

test("'First 90 Days' heading on its own line: unaffected, still correctly excluded while both real actions survive, in all three surfaces", async () => {
  const content =
    "First 90 Days (three actions):\n" +
    "1) Run a pilot with three design partners to validate willingness to pay.\n" +
    "2) Commission a $40,000 independent accuracy benchmark against two incumbents.";

  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(content);
    for (const item of items) {
      assert.doesNotMatch(item, /^first\s+90\s*-?\s*days?/i, `${label}: heading must not appear as an item`);
    }
    assert.equal(items.length, 2, `${label}: expected exactly the 2 real actions`);
  }
});

test("'First 90 Days' + first action on the SAME physical line: the heading is excluded but the embedded action is recovered as its own item, in all three surfaces", async () => {
  const content =
    "First 90 Days (three concrete actions): 1) A concrete, measurable first action with a real owner and budget.\n" +
    "2) A second concrete, measurable action.";

  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(content);
    assert.ok(
      items.some((item) => item.startsWith("A concrete, measurable first action")),
      `${label}: expected the embedded first action to be recovered, got ${JSON.stringify(items)}`
    );
    assert.ok(items.some((item) => item.startsWith("A second concrete")));
    for (const item of items) {
      assert.doesNotMatch(item, /^first\s+90\s*-?\s*days?/i);
    }
  }
});

test("three actions combined on ONE physical line: all three are recovered as separate items, in all three surfaces", async () => {
  const content =
    "Plan: 1) Validate demand with three design partners over 60 days. 2) Commission an independent accuracy benchmark within 90 days. 3) Sign one reseller agreement before scaling further.";

  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(content);
    assert.ok(items.some((item) => item.includes("Validate demand")), `${label}: item 1 missing`);
    assert.ok(items.some((item) => item.includes("Commission an independent accuracy benchmark")), `${label}: item 2 missing`);
    assert.ok(items.some((item) => item.includes("Sign one reseller agreement")), `${label}: item 3 missing`);
  }
});

test("metadata such as '(174 words)' is rejected as an action, in all three surfaces -- including variants with different word counts and phrasing", async () => {
  for (const { label, source } of surfaces) {
    const { isMetadataOnlyRecommendationLine } = await compileExtractors(source);
    for (const variant of ["(174 words)", "(Total 136 words)", "116 words", "(Total 1200 words).", "89 words."]) {
      assert.ok(isMetadataOnlyRecommendationLine(variant), `${label}: expected "${variant}" to be rejected as metadata-only`);
    }
    // Regression guard: a real sentence that happens to mention a word
    // count mid-thought must never be rejected.
    assert.ok(
      !isMetadataOnlyRecommendationLine("This proposal uses about 174 words to describe the rollout plan in full."),
      `${label}: a genuine sentence mentioning a word count must not be treated as metadata`
    );
  }
});

test("no empty action cards: after stripping bullet/number markers, no resulting item is empty, whitespace-only, or a bare word-count footnote, in all three surfaces", async () => {
  const content =
    "1) A real, concrete action with enough length to pass the filter.\n" +
    "2)\n" +
    "3) Another real, concrete action with enough length.\n" +
    "(174 words)";

  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(content);
    for (const item of items) {
      assert.ok(item.trim().length > 8, `${label}: no near-empty item may survive, got ${JSON.stringify(item)}`);
    }
    assert.equal(items.length, 2, `${label}: expected exactly the 2 real actions, empty item 2) and the footnote excluded`);
  }
});

test("Owner/Timeline/Budget/KPI metadata remains attached to the correct (previously-swallowed) action, in all three surfaces", async () => {
  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(realStrategicRecommendationsContent);
    const firstAction = items.find((item) => item.includes("Market-access validation"));
    assert.ok(firstAction, `${label}: expected the recovered first action to be present`);
    assert.match(firstAction, /Owner:\s*Head of Sales/, `${label}: Owner signal must remain attached to this action`);
    assert.match(firstAction, /Budget ceiling:\s*USD 80,000/, `${label}: Budget signal must remain attached`);
    assert.match(firstAction, /KPI:/, `${label}: KPI signal must remain attached`);
    assert.match(firstAction, /within 90 days/, `${label}: timeline context must remain attached`);
  }
});

test("web and PDF receive the same valid action set for the real report content", async () => {
  const results = [];
  for (const { source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    results.push(extractRecommendationItems(realStrategicRecommendationsContent));
  }
  const [pageItems, pdfItems, plannerItems] = results;
  assert.deepEqual(pageItems, pdfItems, "page.tsx and ReportPdfButton.tsx must extract the identical action set");
  assert.deepEqual(pageItems, plannerItems, "page.tsx and Planner.tsx must extract the identical action set");
});

test("no regression: existing normal multi-line recommendations (no shared heading line, no metadata footnote) are completely unaffected, in all three surfaces", async () => {
  const content =
    "1) Validate demand: run 3 customer discovery interviews per week for 60 days.\n" +
    "2) Confirm pricing: test two price points with 10 prospective buyers each.\n" +
    "3) Launch a paid pilot with two design partners within Q3.";

  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 3, `${label}: expected all 3 ordinary actions unchanged`);
    assert.ok(items[0].startsWith("Validate demand"));
    assert.ok(items[1].startsWith("Confirm pricing"));
    assert.ok(items[2].startsWith("Launch a paid pilot"));
  }
});

test("no regression, evidence-standard guard: decimal figures and citation-style parentheticals inside a real action are never mistaken for a new list item boundary, in all three surfaces", async () => {
  const content =
    "1) Grow revenue to $1.5B by scaling the mid-market motion with Owner: Head of Sales, Budget ceiling: USD 90,000; KPI: reach 3.2% market share within 12 months (evidence path: state contract templates like R3).\n" +
    "2) A second real, independent action with enough length to qualify as a genuine recommendation.";

  for (const { label, source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(content);
    assert.equal(items.length, 2, `${label}: a decimal ("3.2%") or citation parenthetical ("R3)") must never be split into a new item, got ${JSON.stringify(items)}`);
    assert.match(items[0], /3\.2% market share/, `${label}: the decimal must survive intact within its own action`);
  }
});

test("no regression: the pre-existing Task #17 verdict-preamble rejections ('Recommendation:'/'Conviction:'/'Trade-offs:') are untouched by this fix, in all three surfaces", async () => {
  for (const { source } of surfaces) {
    const { extractRecommendationItems } = await compileExtractors(source);
    const items = extractRecommendationItems(realStrategicRecommendationsContent);
    for (const item of items) {
      assert.doesNotMatch(item, /^(?:recommendation|conviction|trade-?offs?)\s*:/i);
    }
  }
});
