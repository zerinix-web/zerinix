// TASK #69A-15 -- Make Business Idea Validation Competitor Landscape
// structurally authoritative at generation time.
//
// ROOT CAUSE (traced before writing any code): competitorLandscape's
// generation prompt (app/lib/report-engine/prompts/plan.ts) was pure
// free-form prose with zero structural contract -- no JSON schema
// constrains it (createFullReportJsonSchema, app/lib/report-engine/
// schema.ts, types EVERY one of the 23 planFields as a plain string).
// #69A-13/#69A-14's client-side parsers can reliably recover a real
// competitor's NAME and its own parenthetical description
// (Positioning), but can never reliably recover per-entity Strengths/
// Weaknesses/Threat from prose that never labels those sub-fields per
// competitor in the first place -- that is a genuine absence of
// information, not a parsing bug.
//
// FIX (mirrors the ALREADY-SHIPPED Market Intelligence pattern --
// market-intelligence-canonical-state.ts): strengthened the prompt to
// request one explicitly labeled line per competitor (field stays a
// plain string -- nothing in the schema/persistence pipeline that
// assumes every PlanReportField is a string breaks), then
// deterministically parsed that specific format ONCE at generation
// time (plan-executor.ts) into a canonical, versioned array persisted
// under reports.metadata.businessCompetitorLandscapeState (additive
// JSONB key, no migration). Web/PDF renderers read this structured
// state FIRST; a report with no such state falls back to the existing,
// unmodified #69A-13/#69A-14 prose-parsing tiers.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeState,
  parseStructuredCompetitorLines,
  readBusinessCompetitorLandscapeState,
  BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const planPromptsSource = readFileSync(join(repoRoot, "app/lib/report-engine/prompts/plan.ts"), "utf8");
const reportInvestmentScoreSource = readFileSync(
  join(repoRoot, "app/lib/report-investment-score.ts"),
  "utf8"
);

// The exact self-labeled format plan.ts's updated prompt now requests --
// two REAL, distinct competitors, each with a genuine positioning
// sentence and an honest "Not available" for fields the model wasn't
// confident about.
const STRUCTURED_COMPETITOR_LANDSCAPE_CONTENT = [
  "COMPETITOR: Float | TYPE: Direct competitor | POSITIONING: targets finance teams in SMBs with scenario planning and accounting integrations | STRENGTHS: Not available | WEAKNESSES: Not available | THREAT: Medium",
  "COMPETITOR: Cash Flow Frog | TYPE: Direct competitor | POSITIONING: SMB-focused cash flow forecasting with low-cost tiers | STRENGTHS: strong accountant channel distribution | WEAKNESSES: limited enterprise features | THREAT: Low",
  "",
  "Pricing tiers across the category range from $33/mo to $59+/mo. Incumbent response is likely to be faster integrations. Executive implication: compete via a tight vertical wedge.",
].join("\n");

// --- Root cause / generation contract -----------------------------------

test("root cause: the generation prompt now explicitly requests one self-labeled line per competitor, in a fixed field order, and permits an honest 'Not available' instead of fabrication", () => {
  const fieldMatch = /competitorLandscape:\s*\{[\s\S]{0,900}/.exec(planPromptsSource);
  assert.ok(fieldMatch, "competitorLandscape prompt block not found");
  assert.match(fieldMatch[0], /COMPETITOR: <name> \| TYPE: <Direct competitor or Substitute> \| POSITIONING:/);
  assert.match(fieldMatch[0], /STRENGTHS:.*"Not available".*WEAKNESSES:.*"Not available"/);
  assert.match(fieldMatch[0], /never invent a value you are not confident about/);
});

// --- Requirement A: Float and Cash Flow Frog remain separate -----------

test("requirement A: Float and Cash Flow Frog remain separate, distinct competitor records", () => {
  const state = buildBusinessCompetitorLandscapeState(STRUCTURED_COMPETITOR_LANDSCAPE_CONTENT);
  assert.ok(state, "expected a structured state to be built");
  const companies = state.competitors.map((entity) => entity.company);
  assert.deepEqual(companies, ["Float", "Cash Flow Frog"]);
  assert.equal(new Set(companies).size, companies.length);
});

// --- Requirement B: Positioning never copied into other fields ---------

test("requirement B: Positioning is never copied automatically into Strengths, Weaknesses, or Threat -- each field is captured independently by its own regex group", () => {
  const state = buildBusinessCompetitorLandscapeState(STRUCTURED_COMPETITOR_LANDSCAPE_CONTENT);
  const float = state.competitors.find((entity) => entity.company === "Float");
  assert.ok(float);
  // Float's own positioning text must never leak into fields the model
  // marked "Not available" for.
  assert.notEqual(float.strengths, float.positioning);
  assert.notEqual(float.weaknesses, float.positioning);
  assert.notEqual(float.threat, float.positioning);
  assert.equal(float.strengths, "—");
  assert.equal(float.weaknesses, "—");

  const cashFlowFrog = state.competitors.find((entity) => entity.company === "Cash Flow Frog");
  assert.ok(cashFlowFrog);
  // Cash Flow Frog genuinely HAS real strengths/weaknesses text -- prove
  // it is CashFlowFrog's own text, not Float's, and not its own
  // positioning duplicated.
  assert.equal(cashFlowFrog.strengths, "strong accountant channel distribution");
  assert.equal(cashFlowFrog.weaknesses, "limited enterprise features");
  assert.notEqual(cashFlowFrog.strengths, cashFlowFrog.positioning);
  assert.notEqual(cashFlowFrog.strengths, float.positioning);
  assert.notEqual(cashFlowFrog.weaknesses, float.positioning);
});

// --- Requirement C: structured fields survive persistence round-trip ---

test("requirement C: structured competitor-specific fields survive a JSON persistence round-trip (simulating reports.metadata JSONB) unchanged", () => {
  const built = buildBusinessCompetitorLandscapeState(STRUCTURED_COMPETITOR_LANDSCAPE_CONTENT);
  const persistedMetadata = JSON.parse(
    JSON.stringify({ businessCompetitorLandscapeState: built, someOtherKey: "unrelated" })
  );
  const reloaded = readBusinessCompetitorLandscapeState(persistedMetadata);
  assert.ok(reloaded, "expected the reloaded state to survive the round-trip");
  assert.deepEqual(reloaded, built);
});

test("requirement C: readBusinessCompetitorLandscapeState version-gates -- a mismatched or missing version resolves to null, never a partial/best-effort object", () => {
  assert.equal(
    readBusinessCompetitorLandscapeState({
      businessCompetitorLandscapeState: { version: 999, competitors: [] },
    }),
    null
  );
  assert.equal(readBusinessCompetitorLandscapeState({}), null);
  assert.equal(readBusinessCompetitorLandscapeState(null), null);
  assert.equal(readBusinessCompetitorLandscapeState("not an object"), null);
  assert.equal(
    readBusinessCompetitorLandscapeState({
      businessCompetitorLandscapeState: { version: BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION, competitors: "not an array" },
    }),
    null
  );
});

// --- Requirement D: missing fields remain honestly unavailable ---------

test("requirement D: a field the model marked \"Not available\" (or an equivalent synonym) remains the honest canonical \"—\" marker, never fabricated", () => {
  for (const synonym of ["Not available", "not available", "Unavailable", "Unknown", "N/A", "None"]) {
    const line = `COMPETITOR: TestCo | TYPE: Substitute | POSITIONING: does something | STRENGTHS: ${synonym} | WEAKNESSES: ${synonym} | THREAT: ${synonym}`;
    const [entity] = parseStructuredCompetitorLines(line);
    assert.ok(entity, `expected an entity for synonym "${synonym}"`);
    assert.equal(entity.strengths, "—", `"${synonym}" should normalize to the canonical missing marker`);
    assert.equal(entity.weaknesses, "—");
    assert.equal(entity.threat, "—");
  }
});

// --- Requirement E: legacy free-form reports still render safely -------

test("requirement E: legacy free-form prose (no labeled lines at all) yields null, not an empty/fabricated array -- callers must fall back to the existing prose-parsing tiers", () => {
  const legacyContent =
    "Direct competitors: Float (targets finance teams in SMBs; QuickBooks/Xero/FreeAgent integrations). Substitutes: bookkeeping firms, Excel templates.";
  const state = buildBusinessCompetitorLandscapeState(legacyContent);
  assert.equal(state, null, "legacy prose must never be coerced into a fabricated structured state");
});

test("requirement E: readBusinessCompetitorLandscapeState returns null for a report's metadata that predates this field entirely (the common case for every already-persisted report)", () => {
  const legacyReportMetadata = { benchmarkFit: "some-fit", reportQuality: { score: 80 } };
  assert.equal(readBusinessCompetitorLandscapeState(legacyReportMetadata), null);
});

// --- Requirement F: no fabricated competitor data -----------------------

test("requirement F: every extracted field is verbatim from the input -- parseStructuredCompetitorLines never invents a company name, positioning, or any other field not literally present in the labeled line", () => {
  const line =
    "COMPETITOR: Acme Analytics | TYPE: Direct competitor | POSITIONING: budget SMB tooling | STRENGTHS: fast onboarding | WEAKNESSES: limited integrations | THREAT: High";
  const [entity] = parseStructuredCompetitorLines(line);
  assert.equal(entity.company, "Acme Analytics");
  assert.equal(entity.positioning, "budget SMB tooling");
  assert.equal(entity.strengths, "fast onboarding");
  assert.equal(entity.weaknesses, "limited integrations");
  assert.equal(entity.threat, "High");
  // Every one of these strings is a direct substring of the input line.
  for (const field of [entity.company, entity.positioning, entity.strengths, entity.weaknesses, entity.threat]) {
    assert.ok(line.includes(field), `"${field}" must be verbatim from the input`);
  }
});

test("requirement F: a malformed line missing one of the six required fields is silently skipped, never partially fabricated", () => {
  const malformedLine = "COMPETITOR: Acme | TYPE: Direct competitor | POSITIONING: budget tooling | STRENGTHS: fast onboarding";
  const entities = parseStructuredCompetitorLines(malformedLine);
  assert.equal(entities.length, 0, "a line missing WEAKNESSES/THREAT must not produce a half-built entity");
});

test("requirement F: a category-heading-shaped line (not the labeled format at all) never becomes a fabricated competitor entity", () => {
  const categoryHeadingLine = "Direct competitors: Float, Cash Flow Frog, and others compete in this space.";
  const entities = parseStructuredCompetitorLines(categoryHeadingLine);
  assert.equal(entities.length, 0);
});

// --- Requirement G: web and PDF consume the same canonical data --------

test("requirement G: plan-executor.ts wires businessCompetitorLandscapeState into BOTH the live-generation path and the cached-report path's reportMetadata chunk", () => {
  // TASK #69A-15A superseded the exact literal single-tier computation
  // this test originally pinned: it is now a two-tier expression
  // (schema-enforced Tier 0 first, #69A-15's own prose-line Tier 1 as a
  // fallback) -- see tests/task69a15a's own dedicated coverage for that
  // change. This assertion just confirms the variable is still computed
  // and still flows into the same reportMetadata chunk below.
  // TASK #69A-40B further wrapped the two-tier expression in
  // enrichCompetitorWeaknessesFromEvidence(...) (a deterministic,
  // evidence-based safety net) -- the underlying Tier 0 || Tier 1
  // fallback logic itself, matched below, is unchanged.
  // TASK #69A-45 wrapped that again in attachWeaknessProvenance(...)
  // (derives weaknessSourceRefs/weaknessConfidence from the SAME
  // evidence, never a new tier) -- the inner Tier 0 || Tier 1 fallback
  // and enrichCompetitorWeaknessesFromEvidence call, matched below, are
  // still unchanged.
  assert.match(
    planExecutorSource,
    /const businessCompetitorLandscapeState = attachWeaknessProvenance\(\s*\n\s*enrichCompetitorWeaknessesFromEvidence\(\s*\n\s*buildBusinessCompetitorLandscapeStateFromStructuredResponse\(\s*\n\s*structuredCompetitorLandscapeResponse\s*\n\s*\) \|\| buildBusinessCompetitorLandscapeState\(parsedReport\.competitorLandscape\),/
  );
  // TASK #69A-28 superseded the exact literal condition/argument-list
  // here too: it now also passes portersFiveForcesState (an unrelated,
  // additive 3rd argument) -- see tests/task69a28's own dedicated
  // coverage for that change.
  //
  // TASK #69A-38D superseded the `if (businessCompetitorLandscapeState
  // || portersFiveForcesState)` guard entirely: a report with NEITHER
  // (the exact live-reported case -- zero validated competitors and no
  // Porter structured response) used to skip this second chunk
  // altogether, leaving the client stuck on the EARLY chunk's stale,
  // raw-evidence-derived competitive-evidence score forever. The call
  // is unconditional now, and its context argument is
  // finalResearchAwareFinancialContext (the post-generation, canonical-
  // competitor-corrected context -- see tests/task69a38d's own
  // dedicated coverage) rather than the pre-correction
  // researchAwareFinancialContext. This assertion just confirms
  // businessCompetitorLandscapeState itself still flows into the same
  // call.
  // TASK #69A-63 added a 4th argument (competitorResearchStatus,
  // classifying this as SUCCESS_WITH_EVIDENCE/SUCCESS_NO_EVIDENCE) to
  // this same call -- the assertion now allows an optional trailing
  // argument instead of requiring the call to close right after
  // portersFiveForcesState.
  assert.match(
    planExecutorSource,
    /enqueue\(\s*\n\s*serializePlanReportMetadataChunk\(\s*\n\s*finalResearchAwareFinancialContext,\s*\n\s*businessCompetitorLandscapeState,\s*\n\s*portersFiveForcesState,?[\s\S]{0,260}\)\s*\n\s*\);/
  );
  // TASK #69A-15A superseded the exact literal second-argument
  // expression here too: it now prefers cachedBusinessCompetitorLandscapeState
  // (Tier 0, read back from the AI response cache) before falling back
  // to this same #69A-15 prose-line parse (Tier 1) -- see
  // tests/task69a15a's own dedicated coverage.
  // TASK #69A-63 extracted this Tier 0/Tier 1 expression into its own
  // finalCachedCompetitorLandscapeState const (so it can also be reused
  // to classify competitorResearchStatus), computed just above the call
  // rather than inline inside it -- the preference order itself is
  // unchanged.
  assert.match(
    planExecutorSource,
    /const finalCachedCompetitorLandscapeState =\s*\n\s*cachedBusinessCompetitorLandscapeState \|\|\s*\n\s*buildBusinessCompetitorLandscapeState\(parsedCachedReport\.competitorLandscape\);/
  );
  assert.match(
    planExecutorSource,
    /serializePlanReportMetadataChunk\(\s*\n\s*cachedUnifiedFinancialContext,\s*\n\s*finalCachedCompetitorLandscapeState,/
  );
});

test("requirement G: serializePlanReportMetadataChunk includes businessCompetitorLandscapeState in the SAME chunk as every other metadata field -- never a partial patch that could drop investmentScore/benchmarkFit/benchmarkScore/reportQuality/validationIntelligence from the final persisted metadata (worker.ts replaces wholesale, never merges)", () => {
  // Widened from 700: TASK #69A-63 added a 4th (competitorResearchStatus)
  // parameter to the signature, pushing the chunk body further from the
  // function-name marker without changing its own shape.
  const fnMatch = /function serializePlanReportMetadataChunk\([\s\S]{0,900}/.exec(planExecutorSource);
  assert.ok(fnMatch, "serializePlanReportMetadataChunk not found");
  assert.match(fnMatch[0], /investmentScore: context\.investmentScore,/);
  assert.match(fnMatch[0], /benchmarkFit: context\.benchmarkFit,/);
  assert.match(fnMatch[0], /benchmarkScore: context\.benchmarkScore,/);
  assert.match(fnMatch[0], /reportQuality: context\.reportIntelligence,/);
  assert.match(fnMatch[0], /validationIntelligence: context\.validationIntelligenceV2,/);
  assert.match(fnMatch[0], /\.\.\.\(businessCompetitorLandscapeState \? \{ businessCompetitorLandscapeState \} : \{\}\)/);
});

test("requirement G: ReportMetadata's type declares the new field as optional and additive, mirroring marketIntelligenceCanonicalState's own established pattern", () => {
  assert.match(
    reportInvestmentScoreSource,
    /businessCompetitorLandscapeState\?: import\("@\/app\/lib\/report-engine\/business-competitor-landscape-state"\)\.BusinessCompetitorLandscapeState;/
  );
});

for (const [name, source] of [
  ["Planner.tsx (web card)", plannerSource],
  ["page.tsx (saved/reloaded report)", pageSource],
]) {
  test(`requirement G: ${name} prefers the structured businessCompetitorLandscapeState over extractCompetitorRows' prose-parsing tiers`, () => {
    // TASK #69A-29 superseded the exact literal weaknesses mapping:
    // raw entity.weaknesses is now piped through
    // formatCompetitorWeaknessForDisplay (adds a "(directional)"
    // qualifier when the weakness is an inference, never changes the
    // structured-vs-prose PREFERENCE this test is actually about).
    assert.match(
      source,
      /const competitors = businessCompetitorLandscapeState\s*\n\s*\? businessCompetitorLandscapeState\.competitors\.map\(\(entity\) => \(\{\s*\n\s*company: entity\.type === "Substitute" \? `\$\{entity\.company\} \(Substitute\)` : entity\.company,\s*\n\s*positioning: entity\.positioning,\s*\n\s*strengths: entity\.strengths,\s*\n\s*weaknesses: formatCompetitorWeaknessForDisplay\(entity\),\s*\n\s*threat: entity\.threat,\s*\n\s*\}\)\)\s*\n\s*: extractCompetitorRows\(/
    );
  });
}

test("requirement G: ReportPdfButton.tsx's resolveCompetitorRowsForPdf (used by BOTH the height-measurement and drawing passes) prefers the structured state over extractCompetitorRows", () => {
  const fnMatch = /function resolveCompetitorRowsForPdf\([\s\S]{0,700}/.exec(pdfButtonSource);
  assert.ok(fnMatch, "resolveCompetitorRowsForPdf not found");
  assert.match(fnMatch[0], /const structuredState = readBusinessCompetitorLandscapeState\(report\.metadata\);/);
  assert.match(fnMatch[0], /if \(structuredState\) \{/);
  assert.match(fnMatch[0], /return extractCompetitorRows\(content\);/);
  // Used at both PDF passes, not just one.
  assert.match(pdfButtonSource, /const rows = resolveCompetitorRowsForPdf\(report, content\);/);
  assert.match(pdfButtonSource, /const rows = resolveCompetitorRowsForPdf\(report, section\.content\);/);
});

test("requirement G: Planner.tsx's OWN client-side PDF export (downloadPdf, defined inside ReportPanel) ALSO prefers the structured state, at both its height-measurement and drawing passes -- the fourth independent renderer", () => {
  const fnMatch = /function resolveCompetitorRowsForDownloadPdf\([\s\S]{0,700}/.exec(plannerSource);
  assert.ok(fnMatch, "resolveCompetitorRowsForDownloadPdf not found");
  assert.match(fnMatch[0], /if \(state\) \{/);
  assert.match(fnMatch[0], /return extractCompetitorRows\(content\);/);
  // TASK #69A-45C added a THIRD call site: the dedicated, row-
  // pagination-aware Competitor Landscape branch in pdfSections.forEach
  // (which intercepts before drawPdfVisual is ever called for a real
  // full table) resolves its own rows independently, using the SAME
  // businessCompetitorLandscapeState prop -- never a fourth, divergent
  // row source.
  const occurrences = plannerSource.match(/resolveCompetitorRowsForDownloadPdf\(\s*\n\s*businessCompetitorLandscapeState,/g) || [];
  assert.equal(occurrences.length, 3, "expected exactly 3 call sites (height-measurement + drawing + the #69A-45C dedicated pagination branch)");
});

test("requirement G: businessCompetitorLandscapeState is threaded as a real prop through PremiumSectionVisual -> ReportSectionCard -> ReportPanel, resolved via readBusinessCompetitorLandscapeState at both the desktop and mobile ReportPanel call sites, exactly mirroring marketIntelligenceCanonicalState's own established threading", () => {
  assert.match(plannerSource, /businessCompetitorLandscapeState\?: BusinessCompetitorLandscapeState \| null;/);
  const occurrences = plannerSource.match(/businessCompetitorLandscapeState=\{businessCompetitorLandscapeState\}/g) || [];
  assert.ok(occurrences.length >= 2, "expected the prop threaded through at least ReportSectionCard and PremiumSectionVisual call sites");
  const readOccurrences = plannerSource.match(/readBusinessCompetitorLandscapeState\(\s*\n\s*currentReportMetadata \|\| initialReport\?\.metadata\s*\n\s*\)/g) || [];
  assert.equal(readOccurrences.length, 2, "expected both the mobile and desktop ReportPanel call sites to resolve it");
});

test("requirement G: page.tsx computes businessCompetitorLandscapeState once (mirroring marketIntelligenceCanonicalState's own single-computation comment) and threads it to both ReportSectionVisual call sites", () => {
  assert.match(
    pageSource,
    /const businessCompetitorLandscapeState = readBusinessCompetitorLandscapeState\(report\.metadata\);/
  );
  const occurrences = pageSource.match(/businessCompetitorLandscapeState=\{businessCompetitorLandscapeState\}/g) || [];
  assert.equal(occurrences.length, 2);
});

// --- Preserve all existing authoritative systems (drift check) ---------

test("preserves authority: no canonical decision/confidence/evidence-provenance/Founder-Readiness/Benchmark-Intelligence/TAM-SAM-SOM/financial/risk/report-completion file carries a #69A-15 marker outside plan-executor.ts, prompts/plan.ts, report-investment-score.ts, and the new business-competitor-landscape-state.ts module -- this is a narrowly-scoped generation+persistence+render change, not a rewrite of any other authority", () => {
  for (const relativePath of [
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-consistency-validation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-15/);
  }
});

test("preserves authority: the competitorLandscape prompt's trailing free-prose paragraph (pricing context, incumbent response, switching barriers, gap for a new entrant, executive implication) is preserved -- this fix only structures the per-competitor lines, never removes the surrounding market color the prompt already asked for", () => {
  const fieldMatch = /competitorLandscape:\s*\{[\s\S]{0,900}/.exec(planPromptsSource);
  assert.match(fieldMatch[0], /pricing context, incumbent response, switching barriers, the gap for a new entrant/);
});

test("preserves authority: extractCompetitorRows' own #69A-13/#69A-14 logic (table branch, labeled-clause entity extraction, hardened last-resort tier) is completely untouched by this task -- it remains the fallback for every report without a structured state", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["page.tsx", pageSource],
  ]) {
    assert.match(source, /function extractCompetitorRows\(content: string\) \{/, `${name}: extractCompetitorRows missing`);
    assert.match(source, /const directCompetitorsClause = parseInlineField\(normalized, "Direct competitors"\);/, `${name}: #69A-14 tier missing`);
  }
});
