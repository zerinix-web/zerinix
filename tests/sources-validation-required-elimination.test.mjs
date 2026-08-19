import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION FIX -- "Validation Required" (the internal evidence-
// classification tag) was still customer-visible in the Sources section of
// a live airport ground-handling Business Plan report, DESPITE an earlier
// turn's fix to ReportPdfButton.tsx's own local getPdfCitationSourceTypeLabel/
// getPdfCitationTrustLabel. Root cause: components/planner/Citations.tsx is
// a THIRD, independent copy of this exact citation-labeling logic
// ("Extracted verbatim from components/Planner.tsx" per its own header
// comment) -- the one components/Planner.tsx actually imports and uses for
// its on-screen/PDF-export citation rendering -- and it still had the
// literal "Validation Required" fallback, completely untouched by the
// earlier ReportPdfButton.tsx-only fix. Planner.tsx's own
// formatPdfCitationContent also unconditionally rendered "Source type:"/
// "Confidence:" with no omit-if-empty guard, and had its own separate
// "• Validation Required" zero-citations fallback bullet.
//
// Citations.tsx contains JSX (Citation/SourcesCard components) further
// down, so it can't be directly imported by the plain `node --test`
// runner used for this suite (no JSX loader registered, and its "@/"
// path-aliased imports wouldn't resolve either) -- tested via mirrors of
// the exact pure-function logic plus source drift-checks, matching this
// codebase's established convention for files that can't be cleanly
// imported (e.g. app/lib/report-jobs/plan-executor.ts elsewhere in this
// suite).

const plannerSource = readFileSync(`${repoRoot}components/Planner.tsx`, "utf8");
const citationsSource = readFileSync(`${repoRoot}components/planner/Citations.tsx`, "utf8");

function stripLineComments(code) {
  return code.replace(/\/\/.*$/gm, "");
}

// Mirrors components/planner/Citations.tsx's sourceTypeToEvidenceLevel
// dependency (app/lib/report-evidence.ts, unmodified) closely enough to
// exercise the same classification branches.
function sourceTypeToEvidenceLevel(value, hasUrl = false) {
  if (/\b(user provided|user input|actual operating data)\b/i.test(value)) return "verified";
  if (/\b(planning assumption|assumption|planning input|model assumption)\b/i.test(value)) return "planningAssumption";
  if (/\b(industry|market report|research|benchmark|government|statistics|reference)\b/i.test(value)) return "benchmarkDerived";
  if (hasUrl) return "verified";
  return "validationRequired";
}

// Mirrors the current (fixed) Citations.tsx implementation.
function getPdfCitationSourceTypeLabel(citation) {
  const level = sourceTypeToEvidenceLevel(citation.sourceType || "", Boolean(citation.url));
  if (level === "verified") return "Verified Source";
  if (level === "benchmarkDerived") return "Benchmark Derived";
  if (level === "planningAssumption") return "Planning Assumption";
  return "";
}
function getPdfCitationTrustLabel(citation) {
  const level = sourceTypeToEvidenceLevel(citation.sourceType || "", Boolean(citation.url));
  if (level === "verified") return "Verified";
  if (level === "benchmarkDerived") return "Benchmark Derived";
  if (level === "planningAssumption") return "Planning Assumption";
  return "";
}

test("getPdfCitationSourceTypeLabel never returns the literal 'Validation Required' tag for an unclassified source (the exact live bug)", () => {
  const unclassifiedCitations = [
    { sourceTitle: "Airport Ground Handling Market Report", organization: "Some Aviation Body", url: "" },
    { sourceTitle: "Airport Ops Study", organization: "", url: "" },
    { sourceTitle: "x", organization: "y", sourceType: "" },
    { sourceTitle: "x", organization: "y", sourceType: undefined },
  ];

  for (const citation of unclassifiedCitations) {
    const label = getPdfCitationSourceTypeLabel(citation);
    assert.notEqual(label.toLowerCase(), "validation required");
    assert.equal(label, "");
  }
});

test("getPdfCitationTrustLabel never returns the literal 'Validation Required' tag for an unclassified source (the exact live bug)", () => {
  const citation = { sourceTitle: "Airport Ground Handling Fleet Standards", organization: "IATA", url: "" };
  const label = getPdfCitationTrustLabel(citation);

  assert.notEqual(label.toLowerCase(), "validation required");
  assert.equal(label, "");
});

test("a classified source (verified/benchmark/planning) still gets its real label -- only the unclassified fallback changed", () => {
  assert.equal(
    getPdfCitationSourceTypeLabel({ sourceTitle: "x", organization: "y", sourceType: "Industry reference" }),
    "Benchmark Derived"
  );
  assert.equal(
    getPdfCitationSourceTypeLabel({ sourceTitle: "x", organization: "y", sourceType: "Planning assumption" }),
    "Planning Assumption"
  );
  assert.equal(
    getPdfCitationSourceTypeLabel({ sourceTitle: "x", organization: "y", url: "https://example.com" }),
    "Verified Source"
  );
});

test("Citations.tsx source no longer contains the literal 'Validation Required' fallback return (drift check)", () => {
  const sourceTypeFnMatch = /export function getPdfCitationSourceTypeLabel\([\s\S]*?\n\}/.exec(citationsSource);
  const trustLabelFnMatch = /export function getPdfCitationTrustLabel\([\s\S]*?\n\}/.exec(citationsSource);
  assert.ok(sourceTypeFnMatch, "getPdfCitationSourceTypeLabel not found");
  assert.ok(trustLabelFnMatch, "getPdfCitationTrustLabel not found");
  assert.doesNotMatch(stripLineComments(sourceTypeFnMatch[0]), /"Validation Required"/);
  assert.doesNotMatch(stripLineComments(trustLabelFnMatch[0]), /"Validation Required"/);
  assert.match(sourceTypeFnMatch[0], /return "";\s*\}/);
  assert.match(trustLabelFnMatch[0], /return "";\s*\}/);
});

test("Citations.tsx's getFinalDedupePdfSources entry-building still calls getPdfCitationSourceTypeLabel/getPdfCitationTrustLabel directly, so the fix applies to every consumer (drift check)", () => {
  const fnMatch = /export function getFinalDedupePdfSources\([\s\S]*?\n\}/.exec(citationsSource);
  assert.ok(fnMatch, "getFinalDedupePdfSources not found");
  assert.match(fnMatch[0], /sourceType: getPdfCitationSourceTypeLabel\(citation\)/);
  assert.match(fnMatch[0], /trustLabel: getPdfCitationTrustLabel\(citation\)/);
});

// --- components/Planner.tsx's formatPdfCitationContent --------------------

test("Planner.tsx: Source type / Confidence lines are only rendered when the source actually has a classified value (drift check)", () => {
  assert.match(
    plannerSource,
    /\.\.\.\(source\.sourceType \? \[`  Source type: \$\{source\.sourceType\}`\] : \[\]\)/
  );
  assert.match(
    plannerSource,
    /\.\.\.\(source\.trustLabel \? \[`  Confidence: \$\{source\.trustLabel\}`\] : \[\]\)/
  );
});

test("Planner.tsx: the zero-citations fallback category list no longer uses 'Validation Required' as a bullet heading (drift check)", () => {
  assert.doesNotMatch(plannerSource, /"• Validation Required"/);
  assert.match(plannerSource, /"• Primary Research"/);
});

// --- End-to-end simulation of formatPdfCitationContent's real output -----

function getFinalDedupePdfSources(citations) {
  // Minimal mirror sufficient for this simulation: no cross-citation
  // dedupe/domain logic, just the per-citation label computation this
  // fix actually changed.
  return citations
    .filter((c) => c.url || c.organization || (c.sourceTitle && c.sourceTitle.length >= 4))
    .map((c) => ({
      sourceName: c.organization || c.sourceTitle || "Source",
      sourceType: getPdfCitationSourceTypeLabel(c),
      trustLabel: getPdfCitationTrustLabel(c),
      publisher: c.organization || "",
      publicationYear: c.publicationYear || "",
      url: c.url || "",
    }));
}

test("simulated Sources block for an airport ground-handling report with a mix of classified and unclassified citations contains zero occurrences of 'Validation Required'", () => {
  const citations = [
    {
      sourceTitle: "Airport Ground Handling Safety Standards",
      organization: "International Civil Aviation Organization",
      publicationYear: "2023",
      url: "https://icao.int/example",
    },
    {
      sourceTitle: "Regional Ground Handling Fleet Utilization Study",
      organization: "Airports Council International",
      publicationYear: "",
      url: "",
    },
    {
      sourceTitle: "Ground Support Equipment Market Sizing",
      organization: "",
      publicationYear: "2024",
      url: "",
    },
  ];

  const sources = getFinalDedupePdfSources(citations);
  const sourceLines = sources
    .map((source) =>
      [
        `• ${source.sourceName}`,
        ...(source.sourceType ? [`  Source type: ${source.sourceType}`] : []),
        ...(source.publisher ? [`  Publisher: ${source.publisher}`] : []),
        ...(source.publicationYear ? [`  Year: ${source.publicationYear}`] : []),
        ...(source.trustLabel ? [`  Confidence: ${source.trustLabel}`] : []),
      ].join("\n")
    )
    .join("\n\n");

  assert.doesNotMatch(sourceLines, /Validation Required/i);
  assert.match(sourceLines, /International Civil Aviation Organization/);
  assert.match(sourceLines, /Airports Council International/);
  assert.match(sourceLines, /Ground Support Equipment Market Sizing/);
});
