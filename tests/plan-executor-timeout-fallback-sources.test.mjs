import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Reproduces a real production bug: createGroundedBusinessTimeoutFallback
// (used whenever the report-generation provider call times out) built its
// evidence lines as a single-line "- [R#] Title: claim url" bullet. Neither
// this report's own evidence-summary renderer (evidence-summary.ts's
// extractCitationDetail) nor the PDF's citation parser (ReportPdfButton.tsx's
// parseCitations) recognize that shape -- both only recognize "Title:" /
// "Publisher:" / "URL:" (one field per line) or an "Organization — Title"
// dash-separated line. Every real, verified research source was therefore
// silently unparseable, so the Sources page fell through to its generic
// "no citations found" placeholder (Market Comparisons / Financial
// Comparisons / Planning Assumptions) instead of showing the actual sources.
//
// Tested via source assertions, matching this codebase's established
// convention for plan-executor.ts (heavy Supabase/auth dependencies
// prevent clean direct import), plus a faithful mirror of the real
// citation-line-recognition shape used by both consumers.

const planExecutorSource = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");

// Mirrors ReportPdfButton.tsx's parseCitations metadata-line recognizer
// (and evidence-summary.ts's extractCitationDetail, which uses the same
// Title:/Publisher:/URL: shape) closely enough to prove the new evidence
// lines are actually parseable as citations, not just "look right".
const citationMetadataLinePattern =
  /^(title|source|publisher|organization|year|publication year|url|confidence|source type|type|reference|accessed|access date)\s*[:\-–—]\s*(.+)$/i;

function buildEvidenceLine(item) {
  const title = [item.sourceTitle || item.field, item.claim || item.value]
    .filter(Boolean)
    .join(": ");
  const lines = [`Title: ${title}`];
  if (item.publisher) lines.push(`Publisher: ${item.publisher}`);
  if (item.publishedDate) lines.push(`Year: ${item.publishedDate}`);
  lines.push(`Reference: [${item.id}]`);
  if (item.url) lines.push(`URL: ${item.url}`);
  return lines.join("\n");
}

test("createGroundedBusinessTimeoutFallback builds evidence lines in the source (drift check)", () => {
  assert.match(planExecutorSource, /`Title: \$\{title\}`/);
  assert.match(planExecutorSource, /`Publisher: \$\{item\.publisher\}`/);
  assert.match(planExecutorSource, /`Reference: \[\$\{item\.id\}\]`/);
  assert.match(planExecutorSource, /`URL: \$\{item\.url\}`/);
  // The old, unparseable single-line bullet shape must be gone.
  assert.doesNotMatch(
    planExecutorSource,
    /`- \[\$\{item\.id\}\] \$\{item\.sourceTitle/
  );
});

test("every line of a built evidence entry is recognized by the shared citation-metadata shape", () => {
  const line = buildEvidenceLine({
    id: "R1",
    sourceTitle: "Small Business Lending Report 2026",
    field: "market_size",
    claim: "Small business lending rose 12% year over year",
    publisher: "Federal Reserve",
    publishedDate: "2026",
    url: "https://example.gov/report",
  });

  const fields = line.split("\n").map((entryLine) => {
    const match = citationMetadataLinePattern.exec(entryLine);
    assert.ok(match, `line not recognized as a citation field: ${entryLine}`);
    return match[1].toLowerCase();
  });

  assert.deepEqual(fields, ["title", "publisher", "year", "reference", "url"]);
  assert.match(line, /^Title: Small Business Lending Report 2026: Small business lending rose 12% year over year$/m);
  assert.match(line, /^URL: https:\/\/example\.gov\/report$/m);
});

test("an evidence item with no publisher or URL still produces a recognizable Title line", () => {
  const line = buildEvidenceLine({
    id: "R2",
    sourceTitle: "",
    field: "competitive_landscape",
    claim: "No independently verifiable competitor data was returned",
    publisher: "",
    publishedDate: "",
    url: "",
  });

  assert.match(line, /^Title: competitive_landscape: No independently verifiable competitor data was returned$/m);
  assert.doesNotMatch(line, /^Publisher:/m);
  assert.doesNotMatch(line, /^URL:/m);
});
