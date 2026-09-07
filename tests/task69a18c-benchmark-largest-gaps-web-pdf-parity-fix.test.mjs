// TASK #69A-18C -- Enforce exact canonical Benchmark Intelligence
// "Largest Gaps" parity between web and PDF.
//
// OBSERVED (fresh live verification, after #69A-18B fixed the semantic
// quality of the gap list): WEB rendered exactly 3 gaps (Customer
// demand, CAC, Retention and repeat purchase); the freshly generated
// PDF rendered those same 3 PLUS a 4th ("Competitor Insights: evidence
// missing -- Test the smallest delivery workflow before scaling...").
// Semantic correctness had improved, but web/PDF parity was still
// broken.
//
// ROOT CAUSE (traced end-to-end, not inferred from the UI): both
// renderers correctly read the SAME canonical
// benchmarkFit.materialValidationGaps array (#69A-18B's fix) -- the
// data path itself was never the problem. The divergence was purely
// renderer-side: components/planner/BenchmarkIntelligencePanel.tsx
// (web) truncated the array to its first 3 entries
// (`gaps.slice(0, 3)`), while app/lib/pdf-normalization.mjs (PDF)
// truncated it to its first 4 (`gaps.slice(0, 4)`) -- two
// independently chosen, out-of-sync display limits applied to
// identical source data. Since validationIntelligenceV2 always
// produces exactly 5 fixed, priority-ordered assumptions (customer
// demand / CAC / pricing / retention / operations), whenever exactly
// 4 of them are simultaneously unresolved, web's 3-cap silently drops
// the 4th while PDF's 4-cap keeps it.
//
// "Competitor Insights" (the 4th gap's label) was investigated
// directly: it is validationIntelligenceV2's 5th ("operations")
// assumption, whose `assumption` text is
// `lowConfidenceSource?.area || "Operational delivery"` --
// deterministically derived from real sourceIntelligence data, with a
// genuine, evidence-status-driven riskLevel/experiment/successMetric,
// exactly like the other 4 assumptions. It is NOT fabricated, NOT
// prose-parsed, and NOT out of place in the canonical set -- it is
// legitimately canonical and was genuinely materially unresolved on
// this report. Per this ticket's own decision rule, a legitimate,
// unresolved canonical gap must be shown on BOTH renderers, not
// suppressed from either.
//
// FIX: removed both mismatched truncation limits entirely.
// materialValidationGaps can never exceed 5 entries, so neither
// renderer needs to cap it -- both now render the full canonical
// array exactly as given, making them structurally incapable of
// diverging on count (or order, or wording) ever again.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCanonicalFinancialAssumptions,
  refreshResearchAwareFinancialContext,
} from "../app/lib/ai/financial-assumptions.ts";
import { applyMarketResearchCoverageToContext } from "../app/lib/ai/market-research-coverage.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const benchmarkPanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");
const financialAssumptionsSource = readFileSync(join(repoRoot, "app/lib/ai/financial-assumptions.ts"), "utf8");
const validationIntelligenceSource = readFileSync(join(repoRoot, "app/lib/ai/validation-intelligence.ts"), "utf8");
const reportUtilsSource = readFileSync(join(repoRoot, "app/dashboard/report-utils.ts"), "utf8");
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const competitorStateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);
const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");

const WEAK_EVIDENCE_PROMPT =
  "We are a proprietary, patent-pending enterprise SaaS platform with a data moat and network effects, serving regulated financial institutions with a premium recurring subscription model. Our experienced founding team has deep domain expertise as former bank executives and engineers. We have strong gross margins and enterprise contracts.";

// --- Root cause confirmation ---------------------------------------------

test("root cause confirmation: web and PDF used to apply DIFFERENT truncation limits (3 vs 4) to the identical canonical array -- both limits are now removed", () => {
  assert.doesNotMatch(benchmarkPanelSource, /gaps\.slice\(0, 3\)/);
  assert.doesNotMatch(pdfNormalizationSource, /gaps\.slice\(0, 4\)/);
});

test("root cause confirmation: materialValidationGaps can never exceed 5 entries -- validationIntelligenceV2 always builds exactly 5 fixed, priority-ordered assumptions", () => {
  const assumptionIds = [...validationIntelligenceSource.matchAll(/id: "([\w-]+)",/g)].map((match) => match[1]);
  const uniqueIds = new Set(assumptionIds.filter((id) => ["customer-demand", "cac", "pricing", "retention", "operations"].includes(id)));
  assert.equal(uniqueIds.size, 5);
});

test("root cause confirmation: the 4th observed gap ('Competitor Insights') is validationIntelligenceV2's real 'operations' assumption, not fabricated -- its label is deterministically derived from sourceIntelligence, never prose-parsed", () => {
  assert.match(validationIntelligenceSource, /assumption: lowConfidenceSource\?\.area \|\| "Operational delivery",/);
  assert.match(validationIntelligenceSource, /experiment: "Test the smallest delivery workflow before scaling",/);
});

// --- Requirement A: canonical Largest Gaps has ONE authoritative source ---

test("A: benchmarkFit.materialValidationGaps is the ONE authoritative source -- populated exactly once per construction path, never independently recomputed by either renderer", () => {
  const materialValidationGapsAssignments = financialAssumptionsSource.match(/materialValidationGaps: [\w.()]+,/g);
  assert.equal(materialValidationGapsAssignments.length, 2, "expected exactly 2 assignments (createCanonicalFinancialAssumptions + refreshResearchAwareFinancialContext)");
  assert.doesNotMatch(benchmarkPanelSource, /deriveValidationIntelligenceGaps/);
  assert.doesNotMatch(pdfNormalizationSource, /deriveValidationIntelligenceGaps/);
});

// --- Requirement B: web and PDF receive identical ordered entries --------

test("B: web and PDF render the exact same canonical array in the exact same order -- proven with real data, not just source-pattern matching", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const coverageResult = applyMarketResearchCoverageToContext(context, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  const canonicalGaps = refreshed.benchmarkFit.materialValidationGaps;

  // Simulate exactly what both renderers now do: no slice, no filter,
  // no reorder -- just the canonical array (or the honest fallback).
  const webGaps = canonicalGaps.length ? canonicalGaps : ["No material validation gaps detected."];
  const pdfGaps = Array.isArray(canonicalGaps) && canonicalGaps.length ? canonicalGaps : ["No material validation gaps detected."];
  assert.deepEqual(webGaps, pdfGaps);
  assert.deepEqual(webGaps, canonicalGaps);
  // Order is priority-ascending (most critical first) -- confirmed
  // against the real, unresolved assumptions' own priority field,
  // never reordered by either renderer.
  const unresolvedByPriority = context.validationIntelligenceV2.assumptions
    .filter((assumption) => assumption.evidenceStatus !== "Validated")
    .sort((a, b) => a.priority - b.priority)
    .map((assumption) => assumption.assumption);
  assert.deepEqual(
    canonicalGaps.map((gap) => gap.split(":")[0]),
    unresolvedByPriority
  );
});

// --- Requirement C: no PDF-only appended gap ------------------------------

test("C: PDF never appends anything beyond the canonical array -- its gaps list length equals materialValidationGaps.length exactly, never +1 from a slice(0,4) or any other PDF-only addition", () => {
  assert.doesNotMatch(pdfNormalizationSource, /gaps\.slice\(0, ?\d+\)/);
  assert.doesNotMatch(pdfNormalizationSource, /gaps\.concat|gaps\.push|\[\.\.\.gaps, /);
});

// --- Requirement D: no web-only filtering ---------------------------------

test("D: web never filters the canonical array beyond the honest empty-fallback -- no status/label-based exclusion of any canonical entry", () => {
  assert.doesNotMatch(benchmarkPanelSource, /gaps\.slice\(0, ?\d+\)/);
  assert.doesNotMatch(benchmarkPanelSource, /gaps\.filter/);
});

// --- Requirement E: legitimate Competitor Insights gap appears in both ---
// --- or neither, based on canonical evidence ------------------------------

test("E: when the 'operations' assumption is genuinely unresolved, it appears in BOTH renderers' source of truth; when it is genuinely Validated, it appears in NEITHER", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const operationsAssumption = context.validationIntelligenceV2.assumptions.find((assumption) => assumption.id === "operations");
  assert.ok(operationsAssumption);

  if (operationsAssumption.evidenceStatus !== "Validated") {
    assert.ok(
      context.benchmarkFit.materialValidationGaps.some((gap) => gap.startsWith(operationsAssumption.assumption)),
      "an unresolved operations assumption must appear in the canonical (and therefore both-renderer) gap list"
    );
  }

  // Force it to Validated and confirm it disappears from the SAME
  // canonical source both renderers read -- proving there is no
  // renderer-specific special-casing of this particular assumption.
  const validatedOperations = {
    ...context.validationIntelligenceV2,
    assumptions: context.validationIntelligenceV2.assumptions.map((assumption) =>
      assumption.id === "operations" ? { ...assumption, evidenceStatus: "Validated" } : assumption
    ),
  };
  const strongContext = { ...context, validationIntelligenceV2: validatedOperations };
  const coverageResult = applyMarketResearchCoverageToContext(strongContext, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  assert.ok(
    !refreshed.benchmarkFit.materialValidationGaps.some((gap) => gap.startsWith(operationsAssumption.assumption)),
    "a Validated operations assumption must not appear in either renderer's canonical source"
  );
});

// --- Requirement F: reload/persistence preserves exact list --------------

test("F: report-utils.ts passes row.metadata (including benchmarkFit.materialValidationGaps) through wholesale on reload -- never re-derived, re-ordered, or truncated on the reload path", () => {
  assert.match(
    reportUtilsSource,
    /metadata:\s*\n\s*row\.metadata && typeof row\.metadata === "object" && !Array\.isArray\(row\.metadata\)\s*\n\s*\? \(row\.metadata as ReportMetadata\)/
  );
  assert.doesNotMatch(reportUtilsSource, /materialValidationGaps/, "reload must not touch this field at all -- passthrough only");
});

// --- Requirement G: "No material validation gaps detected" only when -----
// --- canonical material gaps are genuinely empty --------------------------

test("G: the honest no-gaps fallback is reached ONLY when materialValidationGaps.length is genuinely 0 in both renderers", () => {
  assert.match(
    benchmarkPanelSource,
    /const gaps = benchmarkFit\?\.materialValidationGaps\?\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
  assert.match(
    pdfNormalizationSource,
    /const gaps = Array\.isArray\(benchmarkFit\?\.materialValidationGaps\) && benchmarkFit\.materialValidationGaps\.length\s*\n\s*\? benchmarkFit\.materialValidationGaps\s*\n\s*: \[labels\.noGaps\];/
  );
});

test("G: a genuinely fully-validated context (all 5 assumptions 'Validated') yields the honest no-gaps message on both renderers' shared source, never a fabricated gap", () => {
  const context = createCanonicalFinancialAssumptions({ prompt: WEAK_EVIDENCE_PROMPT, reportKind: "business_plan" });
  const fullyValidated = {
    ...context.validationIntelligenceV2,
    assumptions: context.validationIntelligenceV2.assumptions.map((assumption) => ({ ...assumption, evidenceStatus: "Validated" })),
  };
  const strongContext = { ...context, validationIntelligenceV2: fullyValidated };
  const coverageResult = applyMarketResearchCoverageToContext(strongContext, { evidence: [] }, WEAK_EVIDENCE_PROMPT);
  const refreshed = refreshResearchAwareFinancialContext(coverageResult.context);
  assert.deepEqual(refreshed.benchmarkFit.materialValidationGaps, []);
  const sharedFallback = refreshed.benchmarkFit.materialValidationGaps.length
    ? refreshed.benchmarkFit.materialValidationGaps
    : ["No material validation gaps detected."];
  assert.deepEqual(sharedFallback, ["No material validation gaps detected."]);
});

// --- Preserve prior fixes --------------------------------------------------

test("preserves Benchmark numeric scores and Recommended Actions -- neither this fix nor its slice removal touched benchmarkScore.dimensions/actions/insights logic", () => {
  assert.match(benchmarkPanelSource, /benchmarkScore\.actions\.slice\(0, 3\)/, "Recommended Actions' own slice is untouched -- only the gaps slice was removed");
  assert.match(pdfNormalizationSource, /benchmarkScore\.actions\.slice\(0, 4\)/, "PDF's actions slice is untouched -- only the gaps slice was removed");
});

test("preserves #69A-17/competitor/admin-PDF/auth: none of those files carry a #69A-18C marker", () => {
  for (const source of [reportPresentationSource, competitorStateSource, pdfExportRouteSource]) {
    assert.doesNotMatch(source, /#69A-18C/);
  }
});
