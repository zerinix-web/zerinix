import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// market-analysis/route.ts imports "next/server" and cannot be imported
// directly outside Next's own build/dev process (confirmed repeatedly
// this session) -- mirrors the established static-source-text pattern
// used elsewhere in this suite (e.g. dynamic-research-plan.test.mjs) for
// asserting behavior in files that can't be imported.
const routeSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);

// TASK #22 (citation-integrity follow-up) -- confirmed live: the inline-URL
// fix previously ran via enforceInlineRawUrlLimitAcrossSections AFTER the
// deterministic bibliography was already built. Its "known source" branch
// can rewrite a second-or-later inline URL into a real, valid [R#] bracket
// citation -- but the bibliography had already finished scanning `deduped`
// by that point, so that citation would pass assertNoOrphanEvidenceReferences
// while never receiving its own "Reference: [R#]" entry: a real evidence id
// permanently unresolved in the one text a reader (and every UI/PDF
// renderer) actually resolves citations against. Fixed by inlining the
// per-field enforceInlineRawUrlLimit + buildSourceLookupByUrl primitives
// directly in route.ts (rather than the all-in-one
// enforceInlineRawUrlLimitAcrossSections wrapper, whose own sources-field
// folding assumes it runs last) so URL rewriting happens BEFORE the
// bibliography is built from its output. The shared, report-type-agnostic
// inline-source-url-limit.ts module itself, and every other caller of it,
// are untouched -- only this one call site's sequencing changed.

test("route.ts imports the per-field inline-URL-limit primitives, not the all-in-one across-sections wrapper", () => {
  assert.match(
    routeSource,
    /import \{ enforceInlineRawUrlLimit, buildSourceLookupByUrl \} from "@\/app\/lib\/report-engine\/inline-source-url-limit";/
  );
  // The old wrapper name may still appear in an explanatory comment (this
  // fix's own rationale references it), but it must never again be the
  // thing actually imported or called -- that would restore the pre-fix
  // ordering bug this test suite exists to prevent.
  assert.doesNotMatch(
    routeSource,
    /import \{[^}]*enforceInlineRawUrlLimitAcrossSections[^}]*\}/,
    "the all-in-one wrapper must not be reimported at this call site"
  );
  assert.doesNotMatch(
    routeSource,
    /\benforceInlineRawUrlLimitAcrossSections\(/,
    "the all-in-one wrapper must not be called at this call site"
  );
});

test("the inline-URL rewrite runs on `deduped`, after degradation, before the deterministic bibliography is built", () => {
  const wiringIndex = routeSource.indexOf("buildSourceLookupByUrl(graph?.sources)");
  const bibliographyIndex = routeSource.indexOf(
    "deduped.sources = graph\n    ? buildMarketIntelligenceBibliography(deduped, graph, language)"
  );
  const isolationIndex = routeSource.indexOf('assertReportIsolation("market_intelligence", deduped);');
  const finalGateIndex = routeSource.indexOf("assertExecutiveQualityGate({");
  const degradationIndex = routeSource.indexOf("createInsufficientEvidenceFallback(field, language, coverage, graph)");
  const orphanCheckIndex = routeSource.indexOf("assertNoOrphanEvidenceReferences(deduped, graph.citableEvidenceIds);");
  const bibliographyResolutionIndex = routeSource.indexOf(
    "assertCitationsResolveInBibliography(deduped, deduped.sources);"
  );

  assert.ok(wiringIndex > 0, "call site not found");
  assert.ok(bibliographyIndex > 0, "bibliography assignment not found");
  assert.ok(degradationIndex > 0 && degradationIndex < wiringIndex, "must run after degradation");
  assert.ok(
    wiringIndex < bibliographyIndex,
    "URL rewriting must run BEFORE the bibliography is built, so any [R#] it introduces is still captured by the bibliography scan"
  );
  assert.ok(bibliographyIndex < isolationIndex, "must run before assertReportIsolation");
  assert.ok(isolationIndex < finalGateIndex, "assertReportIsolation must precede the final gate");
  assert.ok(
    bibliographyIndex < orphanCheckIndex,
    "the bibliography must exist before the orphan/duplicate/resolution citation gates run"
  );
  assert.ok(
    orphanCheckIndex < bibliographyResolutionIndex,
    "assertCitationsResolveInBibliography must run alongside/after the orphan check, not before"
  );
});

test("the fix skips the sources field, uses maxInlineUrls: 1, and looks URLs up via graph?.sources, matching the prior convention", () => {
  const wiringBlock = routeSource.slice(
    routeSource.indexOf("buildSourceLookupByUrl(graph?.sources)") - 300,
    routeSource.indexOf("buildSourceLookupByUrl(graph?.sources)") + 400
  );
  assert.match(wiringBlock, /buildSourceLookupByUrl\(graph\?\.sources\)/);
  assert.match(wiringBlock, /if \(field === "sources"\) continue;/);
  assert.match(wiringBlock, /enforceInlineRawUrlLimit\(\s*deduped\[field\],\s*1,\s*inlineUrlSourceLookup\s*\)/);
});

test("any extra source lines produced by the URL rewrite (unknown-URL markers) are still folded into the final Sources text", () => {
  const extraLinesIndex = routeSource.indexOf("inlineUrlExtraLines.length > 0");
  const bibliographyIndex = routeSource.indexOf(
    "deduped.sources = graph\n    ? buildMarketIntelligenceBibliography(deduped, graph, language)"
  );
  assert.ok(extraLinesIndex > 0, "extra-lines fold-in not found");
  assert.ok(
    bibliographyIndex < extraLinesIndex,
    "extra lines must be appended AFTER the bibliography is assigned, or they would be overwritten"
  );
});
