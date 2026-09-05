import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// FINAL MARKET INTELLIGENCE LEGACY BODY CLEANUP.
//
// Three genuine, previously-undiscovered bugs traced and fixed this pass:
//
// 1. THE LEGACY RAW BODY. Planner.tsx's live chat view sets a completed
//    report-generation message's content to getReportMarkdown's full
//    dump -- "## {Title}\n\n### {Section}\n{full text}" repeated for
//    every field, TAM/SAM/SOM and Porter's Five Forces included -- and
//    renders it verbatim via MarkdownRenderer, in the SAME view as the
//    premium ReportPanel presenting the identical data as structured
//    cards. Two full renderings of the entire report on one page. Fixed
//    at the render boundary only (ChatMessages.tsx's ChatMessageBubble,
//    and its mobile counterpart in Planner.tsx's renderMessageContent):
//    a completed Market Intelligence report message now displays only
//    its own title line; the underlying message.content is never
//    touched, so copy/edit/regenerate and follow-up chat context are
//    unaffected. page.tsx's persisted dashboard viewer never reads chat
//    messages at all, so it was never part of this bug and needed no
//    change.
//
// 2. TAM/SAM/SOM PARSING GAP (two compounding causes). The model's own
//    natural prose writes "TAM (Total Addressable Market): USD 1.45B" --
//    a parenthetical label expansion, and a 3-letter currency CODE
//    instead of a symbol -- neither of which the existing "[Estimated]
//    bracket tag" fix (from an earlier ticket) tolerated, so the
//    premium card fell back to "Validation Needed"/"Pending ...
//    Validation" while the report's own text plainly stated the figure.
//    Fixed in all three presentation files by tolerating an optional
//    "(...)" label expansion (alongside the existing "[...]" tag) and a
//    common currency code (USD/EUR/GBP/TRY/CAD/AUD/CHF/JPY) alongside
//    the existing symbols -- never a new calculation, purely reading
//    past formatting the original patterns didn't anticipate.
//
// 3. COMPETITIVE LANDSCAPE FALSE "VALIDATION NEEDED". app/lib/report-
//    engine/markdown-table-flattening.ts's flattenMarkdownTables runs on
//    every Market Intelligence field -- including competitiveLandscape --
//    before the deterministic graph projection is spliced back on top.
//    When that graph splice is unavailable for a given generation (e.g.
//    a cached response with no preserved research graph), the flattened
//    "- Vendor — Category: X; Strengths: Y; ..." bullet shape is what
//    actually reaches the section, and the table-only competitor parser
//    saw zero table rows -- "Validation Needed" -- even though the
//    report plainly named real, evidence-backed vendors in that exact
//    bullet text. Fixed with a fallback parser (in all three
//    presentation files) that reads flattenMarkdownTables' own bullet
//    shape using the SAME header vocabulary the deterministic table
//    uses, so the premium card consumes the same underlying vendor data
//    either way -- never fabricating a vendor that was not already named
//    in the content.
//
// Preserved, unmodified: AI generation, prompts, report schema, research/
// source collection, TAM/SAM/SOM calculation and validation logic,
// confidence logic, business logic, routing (drift-checked at the
// bottom). Market Overview's single-premium-presentation fix from the
// prior ticket is unaffected (regression-guarded here too).

const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(
  new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
  "utf8"
);
const chatMessagesSource = readFileSync(
  new URL("../components/planner/ChatMessages.tsx", import.meta.url),
  "utf8"
);
const mobileConversationSource = readFileSync(
  new URL("../components/planner/MobileConversationExperience.tsx", import.meta.url),
  "utf8"
);

// --- 1. The legacy raw body (chat-message duplication) ---------------------

function getReportCompletionHeadlineReference(content) {
  const titleLine = (content || "").split("\n").find((line) => line.trim());
  return titleLine && /^\s*#{1,2}\s+\S/.test(titleLine) ? titleLine : content;
}

test("reference: getReportCompletionHeadline keeps only the report's own title line, discarding every '### Section' heading and body paragraph getReportMarkdown produced", () => {
  const fullReportMarkdown =
    "## Market Intelligence Report\n\n" +
    "### TAM / SAM / SOM\nTAM: USD 1.45B [Estimated]...\n\n" +
    "### Porter's Five Forces\nRivalry is high because...";
  const headline = getReportCompletionHeadlineReference(fullReportMarkdown);

  assert.equal(headline, "## Market Intelligence Report");
  assert.ok(!headline.includes("TAM / SAM / SOM"));
  assert.ok(!headline.includes("Porter's Five Forces"));
  assert.ok(!headline.includes("Rivalry is high"));
});

test("reference: a message that does NOT start with a markdown heading (e.g. a normal chat reply, or the 'preparing...' placeholder text) is returned completely unchanged -- the headline-only behavior never applies outside the specific shape getReportMarkdown always produces", () => {
  assert.equal(
    getReportCompletionHeadlineReference("Sure, here's a quick answer to your follow-up question."),
    "Sure, here's a quick answer to your follow-up question."
  );
});

test("ChatMessages.tsx: getReportCompletionHeadline is exported with the exact reference implementation", () => {
  assert.match(chatMessagesSource, /export function getReportCompletionHeadline\(content: string\)/);
  assert.match(
    chatMessagesSource,
    /const titleLine = \(content \|\| ""\)\.split\("\\n"\)\.find\(\(line\) => line\.trim\(\)\);/
  );
  assert.match(chatMessagesSource, /return titleLine && \/\^\\s\*#\{1,2\}\\s\+\\S\/\.test\(titleLine\) \? titleLine : content;/);
});

test("ChatMessages.tsx: ChatMessageBubble renders the headline-only content ONLY for a completed, assistant-authored, Market Intelligence report message -- an ordinary chat reply, a still-streaming message, and the user's own messages are all untouched", () => {
  assert.match(
    chatMessagesSource,
    /const isCompletedMarketReportMessage =\s*\n\s*!isUser && message\.mode === "market" && message\.status === "complete";/
  );
  assert.match(
    chatMessagesSource,
    /const displayContent = isCompletedMarketReportMessage\s*\n\s*\? getReportCompletionHeadline\(message\.content\)\s*\n\s*: message\.content;/
  );
  assert.match(chatMessagesSource, /content=\{displayContent\}/);
});

test("ChatMessages.tsx: Copy, Edit, and the edit draft still operate on the FULL, untouched message.content -- only the passive inline render is shortened, never the underlying data (no report payload data is deleted)", () => {
  assert.match(chatMessagesSource, /await navigator\.clipboard\.writeText\(message\.content\);/);
  assert.match(chatMessagesSource, /const \[draft, setDraft\] = useState\(message\.content\);/);
});

test("Business Plan/Acquisition/Real Estate report-generation messages (mode === \"plan\") are explicitly excluded -- this fix is scoped to Market Intelligence only, per the ticket's own 'for Market Intelligence reports only' requirement", () => {
  assert.doesNotMatch(chatMessagesSource, /message\.mode === "market" \|\| message\.mode === "plan"/);
});

test("components/Planner.tsx: the mobile conversation view's renderMessageContent applies the identical headline-only rule, imported from the single shared source rather than a second, divergent copy", () => {
  assert.match(plannerSource, /import \{ ChatMessages, getReportCompletionHeadline \} from "@\/components\/planner\/ChatMessages";/);
  assert.match(
    plannerSource,
    /message\.role === "assistant" && message\.mode === "market" && message\.status === "complete"\s*\n\s*\? getReportCompletionHeadline\(message\.content\)\s*\n\s*: message\.content/
  );
});

test("MobileConversationExperience.tsx: MobileConversationMessage's type now declares the mode field the real ChatMessage objects already carry at runtime, rather than Planner.tsx needing an unsafe cast to read it", () => {
  assert.match(mobileConversationSource, /export type MobileConversationMessage = \{[\s\S]{0,600}mode\?: string;/);
});

test("page.tsx's persisted dashboard viewer never reads chat messages -- confirms it was never part of this bug and needed no change (regression guard against reintroducing a chat-message dependency there)", () => {
  assert.doesNotMatch(pageSource, /ChatMessage/);
  assert.doesNotMatch(pageSource, /getReportMarkdown/);
});

// --- 2. TAM/SAM/SOM: parenthetical label + currency-code parsing gap -------

test("reference: a realistic 'TAM (Total Addressable Market): USD 1.45B [Estimated]' line -- both the parenthetical expansion AND the currency CODE -- is now captured (this exact shape returned empty before this fix, in every one of the three presentation files' own parsing strategy)", () => {
  // page.tsx / Planner.tsx style: broad-capture-then-clean.
  function broadCapture(content, label) {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = content
      .replace(/\*\*/g, "")
      .match(new RegExp(`\\b${escapedLabel}\\b\\s*(?:\\([^)\\n]{0,80}\\)\\s*)?(?:\\[[^\\]\\n]{0,40}\\]\\s*)?[:\\-–—]\\s*([^\\n]*)`, "i"));
    return match?.[1]?.trim() || "";
  }
  const line = "TAM (Total Addressable Market): USD 1.45B [Estimated], based on global benchmark data.";
  const captured = broadCapture(line, "TAM");
  assert.ok(captured.includes("USD 1.45B"), `expected the real figure to be captured, got ${JSON.stringify(captured)}`);
});

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
]) {
  // TASK #58 -- both extractMarketSizeCardValue (page.tsx) and
  // extractMarketSizeValue (Planner.tsx) used to carry their own copy of
  // this exact "(...)" -then- "[...]" tolerant regex -- the "(...)" /
  // "[...]" group ordering this test used to check for directly in each
  // file's own source. Both are now pure delegations (for their raw-
  // capture step) to the shared, canonical extractMarketSizingLayerValue
  // (report-presentation.ts), which itself carries the identical
  // "(...)" -then- "[...]" tolerance (see its own "withTag" fallback) --
  // so there is no longer a second copy of this regex in either file to
  // check independently. Updated to prove the delegation itself.
  const fnName = label === "page.tsx" ? "extractMarketSizeCardValue" : "extractMarketSizeValue";
  test(`${label}: ${fnName} delegates its raw-value capture to the canonical extractMarketSizingLayerValue (which itself tolerates an optional "(...)" label expansion in addition to the existing "[...]" tag) -- no independent copy of this extraction rule is left in this file`, () => {
    assert.match(source, new RegExp(`\\bextractMarketSizingLayerValue\\(`), `${fnName} must call the canonical extractor`);
    const fnMatch = source.match(new RegExp(`function ${fnName}\\([\\s\\S]*?\\n\\}`));
    assert.ok(fnMatch, `${fnName} not found`);
    assert.ok(
      !fnMatch[0].includes("0,80") && !fnMatch[0].includes("0,40"),
      `${fnName} must carry zero independent parenthetical/bracket-tolerance regex logic of its own`
    );
  });
}

// TASK #59 -- this exact regex (singleBound/currencyToken, including its
// 3-letter currency CODE support) was promoted from ReportPdfButton.tsx's
// own extractMarketSizeVisualValue into report-presentation.ts's shared
// shapeMarketSizeDisplayValue, so both ReportPdfButton.tsx and
// Planner.tsx's extractMarketSizeValue can use the identical, already-
// correct pattern instead of Planner.tsx's own divergent compactPdfMetricValue
// copy. Updated to check the shared function's new home rather than
// ReportPdfButton.tsx's own source, which no longer contains this regex
// at all (a pure delegation now, see the H2/STRUCTURAL test in
// task59-market-size-display-normalization-unification.test.mjs for the
// delegation proof).
// TASK #60 -- "TL" (the common Turkish Lira abbreviation, distinct from
// the ISO "TRY" code) added to this same currencyToken alongside the
// existing symbols/codes -- updated to match.
test("report-presentation.ts: the canonical shapeMarketSizeDisplayValue's singleBound accepts a 3-letter currency CODE (USD/EUR/GBP/TRY/CAD/AUD/CHF/JPY) alongside the existing symbols, in both bounds of a range", () => {
  const reportPresentationSource = readFileSync(new URL("../app/lib/report-presentation.ts", import.meta.url), "utf8");
  assert.match(
    reportPresentationSource,
    /const currencyToken = "\(\?:\[€\$₺\]\|\(\?:USD\|EUR\|GBP\|TRY\|CAD\|AUD\|CHF\|JPY\|TL\)\\\\b\)";/
  );
  const fnMatch = reportPresentationSource.match(/export function shapeMarketSizeDisplayValue\([\s\S]*?\n\}/);
  assert.ok(fnMatch, "shapeMarketSizeDisplayValue not found");
  const occurrences = fnMatch[0].match(/currencyToken/g) || [];
  // Declaration + a LEADING use in singleBound + a TRAILING use in
  // singleBound (TASK #62 -- a currency indicator trailing the digits,
  // e.g. "18.000.000 TL", is now preserved through shaping too, not
  // just a leading one) + use in valuePattern's own second-bound group
  // (singleBound itself is referenced twice via ${singleBound}
  // interpolation, which doesn't re-print the literal token "currencyToken").
  assert.equal(occurrences.length, 4, `expected currencyToken declared once and reused three times, got ${occurrences.length} occurrences`);
});

test("reference: ReportPdfButton.tsx's fixed pattern preserves the FULL range ('USD 7.3M–21.8M'), not just the first bound -- the most complete of the three files' fixes, since its valuePattern already had range support before this ticket", () => {
  const unitWord = "(?:thousand|million|billion|trillion|milyon|milyar|bin)";
  const currencyToken = "(?:[€$₺]|(?:USD|EUR|GBP|TRY|CAD|AUD|CHF|JPY)\\b)";
  const singleBound = `(?:[<>~≈]?\\s*)?(?:${currencyToken}\\s*)?\\d+(?:[.,]\\d+)*(?:\\s*[kKmMbBtT%]\\b|\\s+${unitWord}\\b)?`;
  const valuePattern = `(${singleBound}(?:\\s*[-–—]\\s*(?:${currencyToken}\\s*)?${singleBound})?)`;
  const line = "SOM: USD 7.3M–21.8M [Estimated]";
  const match = line.match(new RegExp(`^\\s*SOM\\s*[:\\-–—]\\s*${valuePattern}`, "i"));

  assert.equal(match?.[1], "USD 7.3M–21.8M");
});

test("TAM/SAM/SOM cascading resolution logic (tamResolved/samResolved/somResolved, TAM >= SAM >= SOM nesting) is completely untouched -- this pass only fixed how the VALUE is extracted from text, never the validation/nesting rules that consume it (drift check)", () => {
  for (const source of [pageSource, plannerSource]) {
    assert.match(source, /const tamResolved = magnitudes\[0\] !== null;/);
    assert.match(
      source,
      /const samResolved = tamResolved && magnitudes\[1\] !== null && magnitudes\[1\] <= \(magnitudes\[0\] as number\);/
    );
    assert.match(
      source,
      /const somResolved = samResolved && magnitudes\[2\] !== null && magnitudes\[2\] <= \(magnitudes\[1\] as number\);/
    );
  }
});

// --- 3. Competitive Landscape: flattened-table fallback ---------------------

test("reference: a realistic flattenMarkdownTables bullet line ('- Acme AI — Category: Enterprise Platform; Segment: Enterprise; Strengths: Deep integrations; Weaknesses: Limited SMB tooling; Confidence: 88/100 (High); Market Relevance: Strong overlap') is correctly parsed back into a competitor row with every field mapped to the right key -- never conflating Confidence with Market Relevance", () => {
  function extractFlattenedReference(content) {
    const normalized = (content || "").replace(/\*\*/g, "");
    const bulletLines = normalized.split("\n").map((line) => line.trim()).filter((line) => /^-\s+\S/.test(line));
    const read = (fieldMap, keys) => {
      for (const [key, value] of fieldMap) {
        if (keys.some((k) => key.includes(k))) return value;
      }
      return "";
    };
    return bulletLines.map((line) => {
      const withoutBullet = line.replace(/^-\s+/, "");
      const emDashIndex = withoutBullet.indexOf(" — ");
      const vendor = (emDashIndex >= 0 ? withoutBullet.slice(0, emDashIndex) : withoutBullet).trim();
      const fieldsText = emDashIndex >= 0 ? withoutBullet.slice(emDashIndex + 3) : "";
      const fieldMap = fieldsText
        .split("; ")
        .map((pair) => {
          const colonIndex = pair.indexOf(": ");
          return colonIndex < 0 ? null : [pair.slice(0, colonIndex).trim().toLowerCase(), pair.slice(colonIndex + 2).trim()];
        })
        .filter((pair) => pair !== null);
      return {
        vendor,
        category: read(fieldMap, ["category"]),
        position: read(fieldMap, ["segment", "ai capability", "position", "positioning"]),
        strengths: read(fieldMap, ["strength"]),
        weaknesses: read(fieldMap, ["weakness"]),
        relevance: read(fieldMap, ["market relevance"]),
        validationStatus: read(fieldMap, ["confidence"]),
      };
    }).filter((row) => row.vendor || row.strengths || row.weaknesses).slice(0, 20);
  }

  const flattenedContent =
    "## Competitive Landscape\n\nCoverage: 1 vendor identified.\n\n" +
    "- Acme AI — Category: Enterprise Platform; Segment: Enterprise; Strengths: Deep integrations; Weaknesses: Limited SMB tooling; Confidence: 88/100 (High); Market Relevance: Strong overlap with target segment";
  const rows = extractFlattenedReference(flattenedContent);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].vendor, "Acme AI");
  assert.equal(rows[0].category, "Enterprise Platform");
  assert.equal(rows[0].strengths, "Deep integrations");
  assert.equal(rows[0].weaknesses, "Limited SMB tooling");
  assert.equal(rows[0].validationStatus, "88/100 (High)");
  assert.equal(rows[0].relevance, "Strong overlap with target segment");
  assert.notEqual(rows[0].validationStatus, rows[0].relevance);
});

for (const [label, source] of [
  ["page.tsx", pageSource],
  ["Planner.tsx", plannerSource],
  ["ReportPdfButton.tsx", pdfButtonSource],
]) {
  // A later ticket ("RESTORE PREMIUM ANALYTICAL DEPTH") added a third
  // fallback tier (Major Players' own bullets) on top of this one, and
  // split the table-only parser into its own extractMarketIntelligence
  // CompetitorRowsFromTable function so all three tiers could be tried
  // in order from one place -- see
  // tests/market-intelligence-competitive-landscape-major-players-fallback.test.mjs
  // (or its successor) for that fix's own dedicated coverage.
  test(`${label}: extractFlattenedMarketIntelligenceCompetitorRows exists and extractMarketIntelligenceCompetitorRows falls back to it instead of returning [] when no markdown table is present`, () => {
    assert.match(source, /function extractFlattenedMarketIntelligenceCompetitorRows\(content: string\)/);
    assert.match(
      source,
      /const flattenedRows = extractFlattenedMarketIntelligenceCompetitorRows\(content\);\s*\n\s*if \(flattenedRows\.length > 0\) \{\s*\n\s*return flattenedRows;\s*\n\s*\}/
    );
  });

  test(`${label}: the flattened fallback uses the SAME header-key vocabulary (category/segment+ai capability/strength/weakness/market relevance/confidence) as the real table parser, so a row's fields land in the same columns either way`, () => {
    const fnMatch = source.match(/function extractFlattenedMarketIntelligenceCompetitorRows\([\s\S]*?\n\}/);
    assert.ok(fnMatch, "extractFlattenedMarketIntelligenceCompetitorRows not found");
    const fn = fnMatch[0];
    assert.match(fn, /read\(fieldMap, \["category"\]\)/);
    assert.match(fn, /read\(fieldMap, \["segment", "ai capability", "position", "positioning"\]\)/);
    assert.match(fn, /read\(fieldMap, \["strength"\]\)/);
    assert.match(fn, /read\(fieldMap, \["weakness"\]\)/);
    assert.match(fn, /read\(fieldMap, \["market relevance"\]\)/);
    assert.match(fn, /read\(fieldMap, \["confidence"\]\)/);
  });
}

test("the flattened fallback never fabricates a vendor -- it only reads bullet lines already present in the content (\"^-\\\\s+\\\\S\"), and still filters out any parsed row with no vendor/strengths/weaknesses, exactly like the table parser above it", () => {
  for (const source of [pageSource, plannerSource, pdfButtonSource]) {
    const fnMatch = source.match(/function extractFlattenedMarketIntelligenceCompetitorRows\([\s\S]*?\n\}/);
    assert.match(fnMatch[0], /\.filter\(\(line\) => \/\^-\\s\+\\S\/\.test\(line\)\)/);
    assert.match(fnMatch[0], /\.filter\(\(row\) => row\.vendor \|\| row\.strengths \|\| row\.weaknesses\)/);
  }
});

// --- Market Overview regression guard (prior ticket, must still hold) ------

test("Market Overview's single-premium-presentation fix from the prior ticket is unaffected: marketOverview is still in cardFirstReportFields in both files", () => {
  for (const source of [pageSource, plannerSource]) {
    const setMatch = source.match(/const cardFirstReportFields = new Set\(\[([\s\S]*?)\]\);/);
    assert.ok(setMatch, "cardFirstReportFields not found");
    assert.match(setMatch[1], /"marketOverview",/);
  }
});

// --- Drift check: AI generation/prompts/schema/research/business logic -----

test("AI generation, prompts, report schema, research/source collection, and routing are untouched -- this pass only fixed presentation-layer rendering and parsing (drift check)", () => {
  const marketGraphSource = readFileSync(
    new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    marketGraphSource,
    /\| Vendor \| Parent Company \| Category \| Segment \| AI Capability \| Key Use Cases \| Pricing Model \| Strengths \| Weaknesses \| Validation Count \| Confidence \| Market Relevance \|/
  );

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.match(marketPromptSource, /Define TAM, SAM, and SOM using explicit market boundaries/);

  const flatteningSource = readFileSync(
    new URL("../app/lib/report-engine/markdown-table-flattening.ts", import.meta.url),
    "utf8"
  );
  assert.match(flatteningSource, /export function flattenMarkdownTables\(content: string\): string/);

  const routeSource = readFileSync(new URL("../app/api/market-analysis/route.ts", import.meta.url), "utf8");
  assert.match(routeSource, /export async function POST/);
});
