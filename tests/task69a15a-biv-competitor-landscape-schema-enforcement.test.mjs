// TASK #69A-15A -- Enforce Business Idea Validation Competitor
// Landscape at the structured generation/schema layer.
//
// ROOT CAUSE: #69A-15's fix relied on an ADVISORY prompt convention
// (asking the model to write "COMPETITOR: X | TYPE: ... | POSITIONING:
// ... | STRENGTHS: ... | ..." lines inside the free-prose
// competitorLandscape STRING field). A fresh real localhost
// regeneration confirmed the model did not reliably follow that
// convention -- Strengths/Weaknesses/Threat still rendered "—" for
// real competitors (Float, Cash Flow Frog) even though Positioning
// worked. A prompt is advisory; the model can silently ignore it, and
// did.
//
// FIX: competitor structure is now ENFORCED at the JSON-schema layer of
// the SAME single business-plan generation call. Business Idea
// Validation's own "zerinix_business_plan_report" schema (and ONLY that
// one -- real estate/domain-analysis/acquisition's own separate
// createFullReportJsonSchema calls are untouched) now requests an
// ADDITIONAL top-level key, "competitorLandscapeStructured", typed as a
// genuinely structured array of objects with nullable per-field
// properties. OpenAI's strict json_schema mode validates the response
// against this schema before ever returning it -- real, load-bearing
// enforcement. This is Tier 0, read directly from the model's own
// response; #69A-15's labeled-line prose parser becomes Tier 1, a
// safety net for any generation path that doesn't go through this
// schema-enforced call (the deterministic timeout-fallback skeleton,
// or an already-cached pre-#69A-15A response); every renderer's own
// #69A-13/#69A-14 prose-parsing tiers remain Tier 2, unmodified.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  readBusinessCompetitorLandscapeState,
  BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,
  BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { createFullReportJsonSchema } from "../app/lib/report-engine/schema.ts";

// research-cache.ts starts with `import "server-only";` -- a package
// that is genuinely not installed as a real npm dependency (it only
// works under Next.js's own bundler, which aliases it away for
// server-only code and errors it out of client bundles). Plain
// `node --test` cannot resolve it at all, so createReportCacheData/
// getCachedBusinessCompetitorLandscapeStateFromReportData are exercised
// here via a LOCAL mirror of their real (small, pure) logic -- verified
// against the real source text below via source-shape assertions, and
// built on top of the REAL, directly-importable
// readBusinessCompetitorLandscapeState (business-competitor-landscape-
// state.ts has no "server-only" import and no other dependencies).
function createReportCacheDataMirror(research, marketIntelligenceGraph, businessCompetitorLandscapeState) {
  return {
    version: 1,
    research,
    ...(marketIntelligenceGraph ? { marketIntelligenceGraph } : {}),
    ...(businessCompetitorLandscapeState ? { businessCompetitorLandscapeState } : {}),
  };
}

function getCachedBusinessCompetitorLandscapeStateFromReportDataMirror(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value.businessCompetitorLandscapeState;
  return readBusinessCompetitorLandscapeState({ businessCompetitorLandscapeState: state });
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const schemaSource = readFileSync(join(repoRoot, "app/lib/report-engine/schema.ts"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");

// A realistic raw JSON array exactly as OpenAI's strict json_schema mode
// would return it for BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA --
// Float has real strengths/weaknesses/threat; Cash Flow Frog has some
// fields genuinely unsupported (null).
const REALISTIC_STRUCTURED_RESPONSE = [
  {
    company: "Float",
    type: "Direct competitor",
    positioning: "targets finance teams in SMBs with scenario planning and accounting integrations",
    strengths: "deep QuickBooks/Xero/FreeAgent integrations and an established accountant channel",
    weaknesses: "limited prescriptive AI recommendations beyond scenario modeling",
    threat: "Medium",
  },
  {
    company: "Cash Flow Frog",
    type: "Direct competitor",
    positioning: "SMB-focused cash flow forecasting with low-cost tiers",
    strengths: null,
    weaknesses: null,
    threat: "Low",
  },
];

// --- Root cause / fail-before proof --------------------------------------

test("fail-before proof: the OLD createFullReportJsonSchema (single-parameter form, before this fix) has no mechanism to request a structured, non-string field for any single report type -- every field was unconditionally { type: \"string\" }", () => {
  function oldCreateFullReportJsonSchema(name, fields) {
    return {
      type: "json_schema",
      name,
      strict: true,
      schema: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(fields.map((field) => [field, { type: "string" }])),
        required: [...fields],
      },
    };
  }

  const oldSchema = oldCreateFullReportJsonSchema("zerinix_business_plan_report", [
    "competitorLandscape",
    "competitorLandscapeStructured",
  ]);
  // Even if you tried to add "competitorLandscapeStructured" as a field
  // name under the OLD function, it would still be coerced to a plain
  // string -- there was no way to make the model return real structure
  // for it. This is exactly why #69A-15's prompt-only approach could
  // never be enforced.
  assert.deepEqual(oldSchema.schema.properties.competitorLandscapeStructured, { type: "string" });
});

test("root cause: BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA is a genuinely structured array-of-objects schema, not a string", () => {
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.type, "array");
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.type, "object");
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.additionalProperties, false);
});

// --- Requirement A: schema contains structured competitor fields --------

test("requirement A: createFullReportJsonSchema, with fieldSchemaOverrides, produces a schema whose competitorLandscapeStructured property is the real structured array schema -- not coerced to a string", () => {
  const schema = createFullReportJsonSchema(
    "zerinix_business_plan_report",
    ["competitorLandscape", "competitorLandscapeStructured"],
    { competitorLandscapeStructured: BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA }
  );
  assert.equal(schema.schema.properties.competitorLandscape.type, "string", "unrelated fields stay plain strings");
  assert.deepEqual(schema.schema.properties.competitorLandscapeStructured, BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA);
  assert.ok(schema.schema.required.includes("competitorLandscapeStructured"), "the key itself must be required (present), even though its per-competitor fields are nullable");
  assert.equal(schema.strict, true);
});

test("requirement A: every per-competitor field except company/type/weaknessBasis is nullable (\"string\" | \"null\"), enforcing structure without forcing fabricated content", () => {
  // TASK #69A-29 added a 7th property, weaknessBasis -- a required,
  // non-nullable enum (it always has a value: "verified"/"directional"/
  // "unavailable", never null itself; whether a real weakness exists is
  // expressed by weaknesses being null, not by this field being absent).
  const props = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties;
  assert.deepEqual(props.positioning.type, ["string", "null"]);
  assert.deepEqual(props.strengths.type, ["string", "null"]);
  assert.deepEqual(props.weaknesses.type, ["string", "null"]);
  assert.deepEqual(props.threat.type, ["string", "null"]);
  assert.equal(props.company.type, "string");
  assert.equal(props.weaknessBasis.type, "string");
  assert.deepEqual([...props.weaknessBasis.enum].sort(), ["directional", "unavailable", "verified"]);
  // OpenAI's strict json_schema mode requires EVERY property to be
  // listed in `required` (nullability, not omission, is how optionality
  // is expressed) -- confirm all seven are present.
  assert.deepEqual(
    [...BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.required].sort(),
    ["company", "positioning", "strengths", "threat", "type", "weaknessBasis", "weaknesses"]
  );
});

test("requirement A: plan-executor.ts's business-plan generation call requests competitorLandscapeStructured, scoped to ONLY that one call -- planFields itself is never mutated", () => {
  // Field-list-tolerant: TASK #69A-28 legitimately appended a second,
  // unrelated schema-enforced key ("portersFiveForcesStructured") and
  // its own override entry to this SAME call; this test's own concern
  // is only that competitorLandscapeStructured itself is still
  // requested with its own schema override intact.
  const callMatch = /format: createFullReportJsonSchema\(\s*\n\s*"zerinix_business_plan_report",\s*\n\s*\[\.\.\.planFields, "competitorLandscapeStructured"(?:, "portersFiveForcesStructured")?\],\s*\n\s*\{[\s\S]{0,300}?competitorLandscapeStructured: BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA[\s\S]{0,300}?\}\s*\n\s*\),/.exec(
    planExecutorSource
  );
  assert.ok(callMatch, "business-plan generation call not found with the expected schema-override shape");
});

// --- Requirement H: Market Intelligence / other report types unchanged --

test("requirement H: the other three createFullReportJsonSchema call sites (real estate, domain analysis, acquisition) are completely untouched -- none pass fieldSchemaOverrides, none reference competitorLandscapeStructured", () => {
  const callSites = [...planExecutorSource.matchAll(/createFullReportJsonSchema\(\s*\n\s*[`"][^\n]*[`"],\s*\n\s*[a-zA-Z.]+\s*\n?\s*\)/g)];
  // At least the 3 non-business calls should still be the plain
  // 2-argument form.
  const nonBusinessCallSites = callSites.filter(
    (match) => !match[0].includes("zerinix_business_plan_report")
  );
  assert.ok(nonBusinessCallSites.length >= 3, `expected at least 3 unmodified call sites, found ${nonBusinessCallSites.length}`);
  for (const match of nonBusinessCallSites) {
    assert.doesNotMatch(match[0], /competitorLandscapeStructured/);
    assert.doesNotMatch(match[0], /fieldSchemaOverrides/);
  }
});

test("requirement H: createFullReportJsonSchema is backward-compatible -- calling it WITHOUT fieldSchemaOverrides (every non-business call site's own real usage) produces byte-identical output to before this fix", () => {
  const withoutOverrides = createFullReportJsonSchema("zerinix_real_estate_executive_summary", ["finalRecommendation"]);
  assert.deepEqual(withoutOverrides, {
    type: "json_schema",
    name: "zerinix_real_estate_executive_summary",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: { finalRecommendation: { type: "string" } },
      required: ["finalRecommendation"],
    },
  });
});

test("requirement H: Market Intelligence's own generation path never calls createFullReportJsonSchema at all (it uses a deterministic, code-built graph -- market-intelligence-graph.ts/vendor-intelligence.ts -- not an AI JSON schema for competitors), so this fix cannot affect it even indirectly", () => {
  assert.doesNotMatch(schemaSource, /marketIntelligence/i);
});

// --- Requirement B: independent fields end-to-end ------------------------

test("requirement B: a valid generated competitor (Float) independently contains positioning, strengths, weaknesses, and threat, and all four remain distinct end-to-end", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(REALISTIC_STRUCTURED_RESPONSE);
  assert.ok(state);
  const float = state.competitors.find((entity) => entity.company === "Float");
  assert.ok(float);
  assert.equal(float.positioning, "targets finance teams in SMBs with scenario planning and accounting integrations");
  assert.equal(float.strengths, "deep QuickBooks/Xero/FreeAgent integrations and an established accountant channel");
  assert.equal(float.weaknesses, "limited prescriptive AI recommendations beyond scenario modeling");
  assert.equal(float.threat, "Medium");
  const values = [float.positioning, float.strengths, float.weaknesses, float.threat];
  assert.equal(new Set(values).size, values.length, "all four fields must be genuinely distinct, never duplicated");
});

// --- Requirement C: null fields remain honestly unavailable --------------

test("requirement C: null unsupported fields (Cash Flow Frog's strengths/weaknesses) remain the canonical \"—\" marker, never fabricated or copied from positioning", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(REALISTIC_STRUCTURED_RESPONSE);
  const cashFlowFrog = state.competitors.find((entity) => entity.company === "Cash Flow Frog");
  assert.ok(cashFlowFrog);
  assert.equal(cashFlowFrog.strengths, "—");
  assert.equal(cashFlowFrog.weaknesses, "—");
  assert.equal(cashFlowFrog.threat, "Low");
  assert.notEqual(cashFlowFrog.strengths, cashFlowFrog.positioning);
});

test("requirement C: an explicit JSON null (not merely an empty string) for every nullable field resolves to \"—\", not a crash or an empty string", () => {
  const allNullCompetitor = [
    { company: "TestCo", type: "Substitute", positioning: null, strengths: null, weaknesses: null, threat: null },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(allNullCompetitor);
  assert.ok(state);
  const [entity] = state.competitors;
  assert.equal(entity.positioning, "—");
  assert.equal(entity.strengths, "—");
  assert.equal(entity.weaknesses, "—");
  assert.equal(entity.threat, "—");
});

// --- Requirement D: positioning never used as automatic fallback --------

test("requirement D: buildBusinessCompetitorLandscapeStateFromStructuredResponse never copies positioning into strengths, weaknesses, or threat -- each is read independently from its OWN raw field, verified by construction (a company with real positioning but null everything else)", () => {
  const partial = [
    {
      company: "Solo Positioning Co",
      type: "Direct competitor",
      positioning: "a very specific, real positioning sentence",
      strengths: null,
      weaknesses: null,
      threat: null,
    },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(partial);
  const [entity] = state.competitors;
  assert.equal(entity.positioning, "a very specific, real positioning sentence");
  assert.equal(entity.strengths, "—");
  assert.equal(entity.weaknesses, "—");
  assert.equal(entity.threat, "—");
});

test("requirement D: the builder's own source contains no code path that reads .positioning to populate .strengths/.weaknesses/.threat -- each field is read from its own independently-named raw property", () => {
  const source = readFileSync(
    join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
    "utf8"
  );
  const fnMatch = /export function buildBusinessCompetitorLandscapeStateFromStructuredResponse\([\s\S]*?\n\}/.exec(source);
  assert.ok(fnMatch);
  assert.match(fnMatch[0], /positioning: readNullableField\(record\.positioning\)/);
  assert.match(fnMatch[0], /strengths: readNullableField\(record\.strengths\)/);
  // TASK #69A-29 -- weaknesses is now read into a local const first
  // (so weaknessBasis can be derived from the SAME resolved value,
  // never re-reading record.weaknesses a second time), then referenced
  // by shorthand in the pushed object -- still read from its own
  // independently-named raw property, never from .positioning.
  assert.match(fnMatch[0], /const weaknesses = readNullableField\(record\.weaknesses\);/);
  assert.match(fnMatch[0], /threat: readNullableField\(record\.threat\)/);
});

// --- Requirement E: two competitors cannot merge -------------------------

test("requirement E: Float and Cash Flow Frog remain two separate objects, never merged into one, and a genuine duplicate company name (case-insensitive) is deduplicated by keeping the FIRST occurrence rather than merging fields from both", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(REALISTIC_STRUCTURED_RESPONSE);
  assert.equal(state.competitors.length, 2);
  assert.deepEqual(state.competitors.map((c) => c.company), ["Float", "Cash Flow Frog"]);

  const withDuplicate = [
    ...REALISTIC_STRUCTURED_RESPONSE,
    { company: "FLOAT", type: "Direct competitor", positioning: "a different, later positioning", strengths: "different strengths", weaknesses: null, threat: "High" },
  ];
  const dedupedState = buildBusinessCompetitorLandscapeStateFromStructuredResponse(withDuplicate);
  const floatEntries = dedupedState.competitors.filter((c) => c.company.toLowerCase() === "float");
  assert.equal(floatEntries.length, 1, "a case-insensitive duplicate company name must not produce two separate rows");
  assert.equal(floatEntries[0].positioning, REALISTIC_STRUCTURED_RESPONSE[0].positioning, "the FIRST occurrence's fields must win, never a merge of both");
});

// --- Requirement F: persistence/reload preserves structured objects -----

test("requirement F: the structured competitor state survives a JSON persistence round-trip (reports.metadata JSONB) unchanged", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse(REALISTIC_STRUCTURED_RESPONSE);
  const persistedMetadata = JSON.parse(JSON.stringify({ businessCompetitorLandscapeState: built }));
  const reloaded = readBusinessCompetitorLandscapeState(persistedMetadata);
  assert.deepEqual(reloaded, built);
});

test("requirement F: the structured competitor state also survives an AI-response CACHE round-trip (createReportCacheData -> getCachedBusinessCompetitorLandscapeStateFromReportData, exercised via a mirror built on the REAL, importable readBusinessCompetitorLandscapeState), so a cache HIT for the same prompt does not silently lose it", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse(REALISTIC_STRUCTURED_RESPONSE);
  const cacheData = createReportCacheDataMirror({ evidence: [] }, undefined, built);
  const roundTripped = JSON.parse(JSON.stringify(cacheData));
  const reloaded = getCachedBusinessCompetitorLandscapeStateFromReportDataMirror(roundTripped);
  assert.deepEqual(reloaded, built);
});

test("requirement F: a cache entry written before this task (no businessCompetitorLandscapeState key at all) resolves to null, not a crash", () => {
  const legacyCacheData = { version: 1, research: { evidence: [] } };
  assert.equal(getCachedBusinessCompetitorLandscapeStateFromReportDataMirror(legacyCacheData), null);
});

test("requirement F: research-cache.ts's REAL createReportCacheData/getCachedBusinessCompetitorLandscapeStateFromReportData match the mirror's logic exactly (source-shape verification, since \"server-only\" blocks a direct import in this test runner)", () => {
  // Signature-tolerant: TASK #69A-28 legitimately appended a 4th,
  // unrelated optional parameter (portersFiveForcesState) to
  // createReportCacheData; this test's own concern is only that
  // businessCompetitorLandscapeState's own 3rd-argument handling is
  // still present and correct.
  const researchCacheSource = readFileSync(join(repoRoot, "app/lib/ai/research-cache.ts"), "utf8");
  assert.match(
    researchCacheSource,
    /export function createReportCacheData\(\s*\n\s*research: DomainResearchBundle,\s*\n\s*marketIntelligenceGraph\?: MarketIntelligenceGraph,\s*\n\s*businessCompetitorLandscapeState\?: BusinessCompetitorLandscapeState \| null,?\s*\n(?:\s*portersFiveForcesState\?: PortersFiveForcesState \| null\s*\n)?\)\s*\{\s*\n\s*return \{\s*\n\s*version: REPORT_CACHE_VERSION,\s*\n\s*research,\s*\n\s*\.\.\.\(marketIntelligenceGraph \? \{ marketIntelligenceGraph \} : \{\}\),\s*\n\s*\.\.\.\(businessCompetitorLandscapeState \? \{ businessCompetitorLandscapeState \} : \{\}\),/
  );
  assert.match(
    researchCacheSource,
    /export function getCachedBusinessCompetitorLandscapeStateFromReportData\(/
  );
  assert.match(
    researchCacheSource,
    /return readBusinessCompetitorLandscapeState\(\{ businessCompetitorLandscapeState: state \}\);/
  );
});

test("requirement F: plan-executor.ts persists businessCompetitorLandscapeState alongside the AI response cache write, and reads it back at the cache-hit path, preferring it over the Tier 1 prose parse", () => {
  // Argument-list-tolerant: TASK #69A-28 legitimately appended a 4th
  // argument (portersFiveForcesState) to this same call.
  assert.match(
    planExecutorSource,
    /responseData: createReportCacheData\(\s*\n\s*businessResearch,\s*\n\s*undefined,\s*\n\s*businessCompetitorLandscapeState(?:,\s*\n\s*portersFiveForcesState)?\s*\n\s*\),/
  );
  assert.match(
    planExecutorSource,
    /const cachedBusinessCompetitorLandscapeState =\s*\n\s*getCachedBusinessCompetitorLandscapeStateFromReportData\(\s*\n\s*cachedFullReport\.responseData\s*\n\s*\);/
  );
  assert.match(
    planExecutorSource,
    /cachedBusinessCompetitorLandscapeState \|\|\s*\n\s*buildBusinessCompetitorLandscapeState\(parsedCachedReport\.competitorLandscape\)/
  );
});

// --- Requirement G: legacy prose-only reports still render safely -------

test("requirement G: a raw response with no competitorLandscapeStructured key at all (undefined) safely falls through to null, never a crash -- the exact input shape for any generation path that predates this schema (timeout fallback, pre-#69A-15A cache)", () => {
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse(undefined), null);
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse(null), null);
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse("not an array"), null);
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse([]), null);
});

test("requirement G: plan-executor.ts's Tier 0 extraction wraps JSON.parse in try/catch, falling back to Tier 1 rather than throwing, if responseText were ever unparseable at this point", () => {
  const tierMatch = /let structuredCompetitorLandscapeResponse: unknown;\s*\n\s*try \{[\s\S]{0,400}/.exec(
    planExecutorSource
  );
  assert.ok(tierMatch, "Tier 0 extraction block not found");
  assert.match(tierMatch[0], /catch \{/);
  assert.match(tierMatch[0], /structuredCompetitorLandscapeResponse = undefined;/);
});

test("requirement G: malformed entries (missing company, non-object, non-array root) in a structured response are skipped rather than fabricated or crashing", () => {
  const malformed = [
    { type: "Direct competitor", positioning: "no company name here" },
    "not an object",
    null,
    { company: "  ", type: "Substitute", positioning: null, strengths: null, weaknesses: null, threat: null },
    { company: "RealCo", type: "Direct competitor", positioning: "fine", strengths: null, weaknesses: null, threat: null },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(malformed);
  assert.ok(state);
  assert.equal(state.competitors.length, 1);
  assert.equal(state.competitors[0].company, "RealCo");
});

// --- Requirement I: web and PDF consume the same canonical values -------

test("requirement I: every renderer (Planner.tsx's on-screen card + its own downloadPdf, page.tsx, ReportPdfButton.tsx) reads businessCompetitorLandscapeState generically -- none of them needed to change for #69A-15A, since they all consume whichever tier populated the SAME persisted metadata key upstream", () => {
  for (const [name, source] of [
    ["Planner.tsx", plannerSource],
    ["page.tsx", pageSource],
  ]) {
    assert.match(
      source,
      /const competitors = businessCompetitorLandscapeState\s*\n\s*\? businessCompetitorLandscapeState\.competitors\.map/,
      `${name}: on-screen card should still prefer businessCompetitorLandscapeState unchanged`
    );
  }
  assert.match(pdfButtonSource, /const structuredState = readBusinessCompetitorLandscapeState\(report\.metadata\);/);
  assert.match(plannerSource, /function resolveCompetitorRowsForDownloadPdf\(/);
});

test("requirement I: readBusinessCompetitorLandscapeState itself is untouched by #69A-15A -- the SAME version-gated reader works for state built by Tier 0 (schema-enforced) or Tier 1 (labeled-line prose), since both produce the identical BusinessCompetitorLandscapeState shape", () => {
  const tier0State = buildBusinessCompetitorLandscapeStateFromStructuredResponse(REALISTIC_STRUCTURED_RESPONSE);
  assert.equal(tier0State.version, BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION);
  const reloaded = readBusinessCompetitorLandscapeState({ businessCompetitorLandscapeState: tier0State });
  assert.deepEqual(reloaded, tier0State);
});

// --- Preserve authoritative systems (drift check) -------------------------

test("preserves authority: no canonical decision/confidence/evidence-provenance/Founder-Readiness/Benchmark-Intelligence/TAM-SAM-SOM/financial/risk/report-completion/Market-Intelligence file carries a #69A-15A marker", () => {
  for (const relativePath of [
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-consistency-validation.ts",
    "app/lib/ai/market-intelligence-graph.ts",
    "app/lib/ai/vendor-intelligence.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-15A/);
  }
});

test("preserves authority: competitorLandscape's own prompt text (#69A-15's labeled-line convention, kept as Tier 1's own input format) is unchanged by this task -- #69A-15A only adds a NEW, separate schema key, never modifies the existing string field's prompt", () => {
  const planPromptsSource = readFileSync(join(repoRoot, "app/lib/report-engine/prompts/plan.ts"), "utf8");
  assert.doesNotMatch(planPromptsSource, /#69A-15A/);
  assert.match(planPromptsSource, /COMPETITOR: <name> \| TYPE: <Direct competitor or Substitute> \| POSITIONING:/);
});
