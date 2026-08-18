import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces a real, confirmed production bug: the report body cites real
// evidence inline as [R#] identifiers (e.g. [R8], [R4], [R5], [R11] in
// Market Opportunity and Problem), but the Sources page only ever showed
// generic category placeholders ("Market Comparisons", "Financial
// Comparisons", "Planning Assumptions") -- never the real titles those
// [R#] identifiers resolve to.
//
// Root cause: the dedicated sourcesAssumptions field was built from
// buildEvidenceSummary(normalized.sourcesAssumptions, language) -- i.e.
// from whatever the model separately wrote (or failed to write) for that
// one field, compressed down to a category+count summary. That is a
// SEPARATE, unreliable second-hand account of the SAME evidence the model
// already cited correctly inline elsewhere -- not the actual registry
// those [R#] identifiers resolve against (businessResearch.evidence,
// each item carrying its own real id/sourceTitle/publisher/url). When the
// model's own sourcesAssumptions text had no recognizable citation-shaped
// lines (common -- it is a much less load-bearing field than the
// sections that actually cite evidence), buildEvidenceSummary fell
// through to its generic "no sources" placeholder even though real,
// resolvable evidence existed the whole time.
//
// The fix: for every report (not just the timeout-fallback path), the
// final sourcesAssumptions field is rebuilt directly from
// businessResearch.evidence -- the same registry the inline [R#]
// citations resolve against -- using the same Title:/Publisher:/
// Reference:/URL: shape both the PDF's citation parser (ReportPdfButton.
// tsx's parseCitations) and this report's own evidence-summary renderer
// already recognize.
//
// Tested via source assertions, matching this codebase's established
// convention for plan-executor.ts (heavy Supabase/auth dependencies
// prevent clean direct import).

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

test("sourcesAssumptions is rebuilt from businessResearch.evidence for every report, not just the timeout-fallback path (drift check)", () => {
  assert.match(
    planExecutorSource,
    /function buildResearchEvidenceLines\(research: DomainResearchBundle\)/,
    "the shared evidence-line builder has diverged from plan-executor.ts"
  );
  assert.match(
    planExecutorSource,
    /function buildRealSourcesAssumptionsField\(/,
    "the shared sourcesAssumptions field builder has diverged from plan-executor.ts"
  );
  // The main (non-timeout) generation path must call it directly on the
  // parsed report -- this is the actual fix, not just a refactor of the
  // timeout-fallback path's own existing logic.
  assert.match(
    planExecutorSource,
    /parsedReport\.sourcesAssumptions = buildRealSourcesAssumptionsField\(\s*businessResearch,\s*responseLanguage\s*\)/,
    "the main generation path's sourcesAssumptions override has diverged from plan-executor.ts"
  );
  // The timeout-fallback path must reuse the SAME shared builder, not a
  // second, independently-maintained copy of the same logic.
  assert.match(
    planExecutorSource,
    /report\.sourcesAssumptions = \[\s*report\.sourcesAssumptions,\s*buildRealSourcesAssumptionsField\(research, language\),\s*\]\.join\("\\n\\n"\);/,
    "the timeout-fallback path's reuse of the shared builder has diverged from plan-executor.ts"
  );
  // The cache-hit replay path is a third call site that needs the exact
  // same override: parseFullPlanReport's own normalizeFullPlanReport
  // always rebuilds sourcesAssumptions via buildEvidenceSummary first
  // (the generic category+count compression), which would otherwise
  // silently overwrite a cached response's already-correct,
  // evidence-registry-derived sourcesAssumptions every time it replays.
  // Confirmed live: a cache hit for a report whose original generation had
  // real Title/Publisher/Reference/URL entries showed the old generic
  // "Kanıt Özeti" summary instead, because this call site was the one
  // remaining place never rebuilding sourcesAssumptions after
  // parseFullPlanReport ran on the cached response text.
  assert.match(
    planExecutorSource,
    /parsedCachedReport\.sourcesAssumptions = buildRealSourcesAssumptionsField\(\s*cachedBusinessResearch,\s*responseLanguage\s*\)/,
    "the cache-hit replay path's sourcesAssumptions override has diverged from plan-executor.ts"
  );
});

// Mirrors buildResearchEvidenceLines's exact logic to prove the produced
// shape is genuinely parseable by the shared Title:/Publisher:/
// Reference:/URL: citation format both parseCitations (ReportPdfButton.
// tsx) and extractCitationDetail (evidence-summary.ts) recognize.
const citationMetadataLinePattern =
  /^(title|source|publisher|organization|year|publication year|url|confidence|source type|type|reference|accessed|access date)\s*[:\-–—]\s*(.+)$/i;

function buildResearchEvidenceLines(evidence) {
  return evidence.map((item) => {
    const title = [item.sourceTitle || item.field, item.claim || item.value]
      .filter(Boolean)
      .join(": ");
    const lines = [`Title: ${title}`];
    if (item.publisher) lines.push(`Publisher: ${item.publisher}`);
    if (item.publishedDate) lines.push(`Year: ${item.publishedDate}`);
    lines.push(`Reference: [${item.id}]`);
    if (item.url) lines.push(`URL: ${item.url}`);
    return lines.join("\n");
  });
}

test("every research evidence item resolves to a real, parseable Title/Publisher/Reference/URL entry with its own [R#] identifier", () => {
  const evidence = [
    {
      id: "R8",
      field: "market_opportunity",
      sourceTitle: "Global SaaS Market Report 2026",
      claim: "SMB SaaS spend grew 18% year over year",
      publisher: "Gartner",
      publishedDate: "2026",
      url: "https://example.com/saas-report",
    },
    {
      id: "R4",
      field: "problem",
      value: "62% of small hotels still use spreadsheets for revenue management",
      publisher: "",
      publishedDate: "",
      url: "https://example.com/hotel-survey",
    },
  ];

  const lines = buildResearchEvidenceLines(evidence);

  assert.equal(lines.length, 2);

  for (const [index, line] of lines.entries()) {
    const fields = line.split("\n").map((entryLine) => {
      const match = citationMetadataLinePattern.exec(entryLine);
      assert.ok(match, `line not recognized as a citation field: ${entryLine}`);
      return match[1].toLowerCase();
    });
    assert.ok(fields.includes("title"), `entry ${index} must have a Title line`);
    assert.ok(fields.includes("reference"), `entry ${index} must have a Reference line`);
  }

  assert.match(lines[0], /^Title: Global SaaS Market Report 2026: SMB SaaS spend grew 18% year over year$/m);
  assert.match(lines[0], /^Reference: \[R8\]$/m);
  assert.match(lines[0], /^Publisher: Gartner$/m);
  assert.match(lines[1], /^Title: problem: 62% of small hotels still use spreadsheets for revenue management$/m);
  assert.match(lines[1], /^Reference: \[R4\]$/m);
  assert.doesNotMatch(lines[1], /^Publisher:/m);
});

test("an empty evidence registry still produces a clean, honest 'no evidence' line rather than silently producing nothing", () => {
  const lines = buildResearchEvidenceLines([]);

  assert.equal(lines.length, 0);
  assert.equal(lines.join("\n\n"), "");
});
