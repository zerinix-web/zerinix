// TASK #69A-16 -- Restore evidence-backed competitor intelligence into
// Business Idea Validation structured generation.
//
// VERIFIED STARTING STATE (after #69A-15C): a fresh Business Idea
// Validation regeneration correctly, honestly rendered "No competitor
// data could be validated for this market yet." -- the semantic guards
// added in #69A-15C were working exactly as designed. That is NOT the
// bug this ticket fixes; it is the correct behavior for an evidence-free
// report and must be preserved (requirement G below).
//
// ROOT CAUSE (traced, not guessed): the research layer (domain-research.ts)
// DOES retrieve named-competitor evidence -- there is a dedicated
// "competitors" research field ("Verify current competitors, positioning,
// pricing, and substitute offerings"), and it reaches the generation
// prompt via businessResearchContext (formatDomainResearchForReportGeneration),
// interpolated into the SAME prompt that requests competitorLandscapeStructured.
// But nowhere in the actual prompt TEXT sent to the model (verboseFullReportInput
// / fullReportInput / compactReportQualityRules) was the model ever told to
// map that evidence into competitorLandscapeStructured -- the ONLY place
// that obligation existed was inside BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA's
// own `description` strings (part of the schema/response_format config,
// a materially weaker signal than an explicit natural-language mapping
// instruction in the main prompt body). The model was therefore free to
// return an empty (or near-empty) array even when real competitor
// evidence was available -- exactly the behavior #69A-15C's real
// production trace observed for this specific field.
//
// FIX: a new, narrow, business-plan-only prompt paragraph, positioned
// immediately after "Return exactly these JSON keys and no others" and
// BEFORE "Report quality rules:" (so it survives the existing
// verbose->compact substitution unconditionally), explicitly instructing
// the model to map named competitors from the evidence registry into
// competitorLandscapeStructured, to populate each attribute
// independently and ONLY when evidence-supported, to include a
// competitor even when only identity (+ positioning) is supported, and
// to return an empty array rather than fabricate one when no real
// competitor is evidenced. The JSON schema's own top-level `description`
// was also strengthened with matching guidance, as a second, redundant
// signal. Neither change touches extraction/normalization/persistence
// logic (business-competitor-landscape-state.ts's functions, all of
// #69A-15C's renderer guards) -- this is purely a generation-CONTRACT
// strengthening. Because the actual prompt text changed,
// BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped v1 -> v2 (the
// exact mechanism #69A-15B built for this exact situation) so a cache
// entry written under the old, weaker contract can never be served as if
// it satisfies the new one.
import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBusinessCompetitorLandscapeStateFromStructuredResponse,
  buildBusinessCompetitorLandscapeState,
  readBusinessCompetitorLandscapeState,
  BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,
} from "../app/lib/report-engine/business-competitor-landscape-state.ts";
import { createFullReportJsonSchema } from "../app/lib/report-engine/schema.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const planExecutorSource = readFileSync(join(repoRoot, "app/lib/report-jobs/plan-executor.ts"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const pdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");

// research-cache.ts's own cache-key mirror (identical technique to
// #69A-15B/15C's own test files -- "server-only" blocks a direct import
// under plain `node --test`).
function createAiCacheKeyMirror(parts) {
  const normalizedParts = {
    operationType: parts.operationType ?? "mirror-fixed-for-test",
    endpoint: parts.endpoint,
    inputHash: crypto.createHash("sha256").update(parts.normalizedPrompt).digest("hex"),
    mode: parts.mode,
    language: parts.language,
    model: parts.model,
    options: parts.options
      ? Object.keys(parts.options)
          .sort()
          .reduce((sorted, key) => {
            sorted[key] = parts.options?.[key];
            return sorted;
          }, {})
      : {},
  };
  return crypto.createHash("sha256").update(JSON.stringify(normalizedParts)).digest("hex");
}

// --- Root cause confirmation (final-report items 1/2/3) ------------------

test("root cause confirmation: domain-research.ts has a dedicated 'competitors' research field aimed at named competitor identification", () => {
  // TASK #69A-29 -- widened this objective's own text (additively) to
  // also ask for differentiation/limitation signals, so a defensible
  // weakness inference has real evidence to point to. Still the same
  // dedicated field, still only ever asking for real, verifiable
  // evidence -- never a directive to invent one.
  const domainResearchSource = readFileSync(join(repoRoot, "app/lib/ai/domain-research.ts"), "utf8");
  assert.match(domainResearchSource, /field: "competitors",/);
  assert.match(
    domainResearchSource,
    /objective:\s*\n?\s*"Verify current competitors, positioning, pricing, substitute offerings, and any differentiation, target-segment, or limitation signals that could support a strengths\/weaknesses comparison\."/
  );
});

test("root cause confirmation: the evidence registry (businessResearchContext) is interpolated into the SAME prompt that requests competitorLandscapeStructured", () => {
  assert.match(planExecutorSource, /Completed domain-aware research:\n\$\{businessResearchContext\}/);
  const evidenceIndex = planExecutorSource.indexOf("Completed domain-aware research:");
  const schemaCallIndex = planExecutorSource.indexOf('"zerinix_business_plan_report"');
  assert.ok(evidenceIndex >= 0 && schemaCallIndex > evidenceIndex, "expected the evidence registry to be built into the same request as the schema-enforced call");
});

test("root cause confirmation (BEFORE this fix's own paragraph is considered): prior to this ticket, no prompt text instructed the model to map evidence into competitorLandscapeStructured -- only the schema's own description strings ever mentioned it. This test locks in the CURRENT (fixed) state: the mapping instruction now lives in the actual prompt body, not only the schema.", () => {
  assert.match(
    planExecutorSource,
    /Competitor Landscape structured mapping requirement \(competitorLandscapeStructured\):/
  );
});

// --- Fix proof: the new prompt paragraph exists, is positioned to ------
// --- survive compact substitution, and is generic -----------------------

test("fix proof: the new mapping-requirement paragraph sits between the JSON key list and 'Report quality rules:', so it is NEVER stripped by the verbose->compact substitution (which only replaces from 'Report quality rules:' onward)", () => {
  const keysIndex = planExecutorSource.indexOf("Return exactly these JSON keys and no others:");
  const mappingIndex = planExecutorSource.indexOf("Competitor Landscape structured mapping requirement");
  // indexOf from mappingIndex onward -- the bare string "Report quality
  // rules:" also appears earlier in the file (a completely different,
  // single-field prompt block), so searching from the start of the file
  // would find THAT occurrence instead of the one immediately following
  // this fix's own paragraph.
  const rulesIndex = planExecutorSource.indexOf("Report quality rules:\n${buildFullReportStructureDirectives", mappingIndex);
  assert.ok(keysIndex >= 0 && mappingIndex > keysIndex && rulesIndex > mappingIndex);
});

test("fix proof: the mapping-requirement paragraph explicitly tells the model to (a) use the evidence registry, (b) populate each attribute independently and only when evidence-supported, (c) include identity-only/partial competitors, (d) never fabricate to fill columns, and (e) return an empty array rather than invent a competitor", () => {
  const start = planExecutorSource.indexOf("Competitor Landscape structured mapping requirement");
  const end = planExecutorSource.indexOf("Report quality rules:\n${buildFullReportStructureDirectives", start);
  const block = planExecutorSource.slice(start, end);
  assert.match(block, /evidence registry/i);
  assert.match(block, /independently set positioning, strengths, weaknesses, and threat ONLY when/i);
  assert.match(block, /Include a competitor even when only its identity and positioning are supported/i);
  assert.match(block, /Never invent a company, and never invent strengths, weaknesses, or threat merely to fill every field/i);
  assert.match(block, /return an empty array for competitorLandscapeStructured rather than fabricating one/i);
});

test("fix proof: the mapping-requirement paragraph is completely generic -- no hardcoded company name (Float, Cash Flow Frog, QuickBooks, Xero, or any other specific vendor) anywhere in it", () => {
  const start = planExecutorSource.indexOf("Competitor Landscape structured mapping requirement");
  const end = planExecutorSource.indexOf("Report quality rules:\n${buildFullReportStructureDirectives");
  const block = planExecutorSource.slice(start, end);
  for (const forbidden of ["Float", "Cash Flow Frog", "QuickBooks", "Xero", "FreeAgent"]) {
    assert.doesNotMatch(block, new RegExp(forbidden, "i"), `mapping instruction must never hardcode "${forbidden}"`);
  }
});

test("fix proof: the schema's own top-level description was strengthened with matching guidance (evidence registry sourcing, identity-only competitors allowed, empty array when unsupported) -- still fully generic, no hardcoded company", () => {
  const description = BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.description;
  assert.match(description, /research evidence registry/i);
  assert.match(description, /do not withhold a real, named competitor merely because strengths\/weaknesses\/threat lack evidence/i);
  assert.match(description, /return an empty array rather than inventing one/i);
  for (const forbidden of ["Float", "Cash Flow Frog", "QuickBooks", "Xero"]) {
    assert.doesNotMatch(description, new RegExp(forbidden, "i"));
  }
});

test("[UPDATED BY #69A-29] fix proof: #69A-16's OWN fix only strengthened description text, never the shape OpenAI's strict mode validates against -- #69A-29 later legitimately added a new required property (weaknessBasis) for its own, separately-ticketed reason", () => {
  // TASK #69A-29 -- added weaknessBasis (a real structural change, not
  // a #69A-16 regression): a required, non-nullable provenance enum
  // for the weaknesses field, so "verified" vs "directional" vs
  // "unavailable" is a structural fact, never inferred by a renderer.
  // The array/object/additionalProperties shape and strengths' own
  // nullability -- the parts #69A-16 itself never touched -- remain
  // exactly as they were.
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.type, "array");
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.type, "object");
  assert.equal(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.additionalProperties, false);
  assert.deepEqual(
    [...BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.required].sort(),
    ["company", "positioning", "strengths", "threat", "type", "weaknessBasis", "weaknesses"]
  );
  assert.deepEqual(BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA.items.properties.strengths.type, ["string", "null"]);
});

test("scope proof: this fix's new prompt paragraph and description text appear ONLY in the business-plan generation path -- the other three createFullReportJsonSchema call sites (real estate, domain analysis, acquisition) are untouched, and no unrelated shared schema helper changed", () => {
  const schemaSource = readFileSync(join(repoRoot, "app/lib/report-engine/schema.ts"), "utf8");
  assert.doesNotMatch(schemaSource, /Competitor Landscape structured mapping requirement/);
  assert.doesNotMatch(schemaSource, /research evidence registry/i);
  // createFullReportJsonSchema's own function body/signature is untouched.
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

// --- Cache: version bump proof (final-report item 5) ---------------------

test("[UPDATED BY #69A-28] cache proof: BUSINESS_PLAN_GENERATION_CONTRACT_VERSION was bumped to a value distinct from #69A-15B's original v1 ('competitor-structured-v1') and #69A-16's own v2 ('competitor-structured-v2'), because the generation contract changed again", () => {
  // TASK #69A-28 -- this constant's own NAMING convention is not fixed
  // forever (it is a free-form cache-busting tag, not a strict
  // "competitor-structured-vN" counter) -- #69A-28 renamed it to
  // "porter-structured-v3" when it added the schema-enforced Porter's
  // Five Forces key, on top of (not replacing) #69A-16's own
  // competitor-mapping contract change. This test now proves the
  // weaker, still-meaningful invariant every future ticket that bumps
  // this constant can keep satisfying: the value differs from both
  // prior historical values, so a stale cache entry from either era
  // still misses.
  const match = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "([^"]+)";/.exec(planExecutorSource);
  assert.ok(match, "expected the versioned contract constant to still exist");
  assert.notEqual(match[1], "competitor-structured-v1", "#69A-15B's original value must not still be in use");
  assert.notEqual(match[1], "competitor-structured-v2", "#69A-16's value must not still be in use unchanged");
});

test("cache proof: the SAME reportVariant call site (business-plan, fullReportCacheKey) is the one carrying the bumped version -- untouched real_estate/domain_decision_analysis call sites still don't reference it", () => {
  assert.match(
    planExecutorSource,
    /reportVariant: `\$\{FULL_REPORT_FIELD\}:\$\{canonicalFinancialAssumptions\.version\}:\$\{canonicalFinancialAssumptions\.fingerprint\}:\$\{BUSINESS_PLAN_GENERATION_CONTRACT_VERSION\}`,/
  );
  const contractVersionUsageCount = (planExecutorSource.match(/BUSINESS_PLAN_GENERATION_CONTRACT_VERSION/g) || []).length;
  assert.equal(contractVersionUsageCount, 2, "expected exactly one declaration + one usage, unchanged in count/location from #69A-15B");
});

test("[UPDATED BY #69A-28] cache proof: a cache key computed under the OLD v1 contract tag differs from one computed under the CURRENT contract tag for the identical business idea/model/financial-assumptions -- so a pre-#69A-16 cache entry is guaranteed to miss and force a genuine, contract-compliant model call", () => {
  const currentVersionMatch = /const BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "([^"]+)";/.exec(planExecutorSource);
  assert.ok(currentVersionMatch);
  const currentVersion = currentVersionMatch[1];
  assert.notEqual(currentVersion, "competitor-structured-v1", "this ticket must have bumped past v1");

  const sharedParams = {
    endpoint: "/api/plan",
    normalizedPrompt: JSON.stringify({ normalizedPrompt: "an arbitrary future business idea", reportFamily: "business_plan" }),
    language: "en",
    model: "gpt-5-mini",
    options: { analysisMode: "standard", contextFingerprint: "", uploadedAssetHash: "" },
  };

  const oldKey = createAiCacheKeyMirror({
    ...sharedParams,
    mode: `pre-research-report-v1:business_plan:fullReport:v3:abc123:competitor-structured-v1`,
  });
  const currentKey = createAiCacheKeyMirror({
    ...sharedParams,
    mode: `pre-research-report-v1:business_plan:fullReport:v3:abc123:${currentVersion}`,
  });

  assert.notEqual(oldKey, currentKey, "a v1-tagged cache entry must miss against the current, stronger contract's cache key");
});

// --- Requirement A: evidence-backed identities produce structured rows --

// A realistic, ARBITRARY (never Float/Cash Flow Frog/QuickBooks/Xero)
// fixture representing what the model should now return for a
// completely different, future business idea, grounded entirely in
// hypothetical evidence -- proves the fix generalizes.
const ARBITRARY_EVIDENCE_BACKED_RESPONSE = [
  {
    company: "Northwind Ledger",
    type: "Direct competitor",
    positioning: "targets independent freelancers with automated expense categorization",
    strengths: "deep bank-feed integrations across 4 major regional banks",
    weaknesses: "no multi-currency support for cross-border freelancers",
    threat: "Medium",
  },
  {
    company: "Ledgerly",
    type: "Substitute",
    positioning: "spreadsheet-template alternative marketed to solo consultants",
    strengths: null,
    weaknesses: null,
    threat: null,
  },
];

test("requirement A: evidence-backed competitor identities (arbitrary, non-hardcoded fixture) produce structured rows with all four attributes read independently", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(ARBITRARY_EVIDENCE_BACKED_RESPONSE);
  assert.ok(state);
  const northwind = state.competitors.find((c) => c.company === "Northwind Ledger");
  assert.ok(northwind);
  assert.equal(northwind.positioning, "targets independent freelancers with automated expense categorization");
  assert.equal(northwind.strengths, "deep bank-feed integrations across 4 major regional banks");
  assert.equal(northwind.weaknesses, "no multi-currency support for cross-border freelancers");
  assert.equal(northwind.threat, "Medium");
});

// --- Requirement B: identity + positioning only, rest "—" ---------------

test("requirement B: a competitor with supported identity + positioning but unsupported strengths/weaknesses/threat renders company=real name, positioning=supported value, and strengths/weaknesses/threat all \"—\" -- never omitted, never fabricated", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(ARBITRARY_EVIDENCE_BACKED_RESPONSE);
  const ledgerly = state.competitors.find((c) => c.company === "Ledgerly");
  assert.ok(ledgerly, "identity-only competitor must still be included as its own row");
  assert.equal(ledgerly.positioning, "spreadsheet-template alternative marketed to solo consultants");
  assert.equal(ledgerly.strengths, "—");
  assert.equal(ledgerly.weaknesses, "—");
  assert.equal(ledgerly.threat, "—");
});

test("requirement B: a competitor whose identity is the ONLY supported attribute (positioning also null) still produces a row -- the entity is never withheld merely for lacking analytical attributes", () => {
  const identityOnly = [
    { company: "Arbitrary Future Co", type: "Unknown", positioning: null, strengths: null, weaknesses: null, threat: null },
  ];
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(identityOnly);
  assert.ok(state);
  assert.equal(state.competitors.length, 1);
  assert.equal(state.competitors[0].company, "Arbitrary Future Co");
  assert.equal(state.competitors[0].positioning, "—");
});

// --- Requirement C: never fabricate symmetry ------------------------------

test("requirement C: unsupported attributes are never fabricated to match the populated ones -- Ledgerly's null fields resolve to the canonical missing marker, never a guessed value derived from its positioning or type", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(ARBITRARY_EVIDENCE_BACKED_RESPONSE);
  const ledgerly = state.competitors.find((c) => c.company === "Ledgerly");
  assert.notEqual(ledgerly.strengths, ledgerly.positioning);
  assert.notEqual(ledgerly.weaknesses, ledgerly.positioning);
  assert.notEqual(ledgerly.threat, ledgerly.positioning);
});

// --- Requirement I: positioning never leaks into other columns ----------

test("requirement I: Northwind Ledger's four fields remain genuinely distinct -- positioning is never copied into strengths/weaknesses/threat by construction", () => {
  const state = buildBusinessCompetitorLandscapeStateFromStructuredResponse(ARBITRARY_EVIDENCE_BACKED_RESPONSE);
  const northwind = state.competitors.find((c) => c.company === "Northwind Ledger");
  const values = [northwind.positioning, northwind.strengths, northwind.weaknesses, northwind.threat];
  assert.equal(new Set(values).size, values.length);
});

// --- Requirement D: full round trip --------------------------------------

test("requirement D: evidence-backed structured state survives generation (arbitrary fixture) -> normalization -> JSON persistence round-trip -> reload -> renderer read, byte-identical", () => {
  const built = buildBusinessCompetitorLandscapeStateFromStructuredResponse(ARBITRARY_EVIDENCE_BACKED_RESPONSE);
  const persistedMetadata = JSON.parse(JSON.stringify({ businessCompetitorLandscapeState: built }));
  const reloaded = readBusinessCompetitorLandscapeState(persistedMetadata);
  assert.deepEqual(reloaded, built);

  for (const [name, source] of [["Planner.tsx", plannerSource], ["page.tsx", pageSource]]) {
    assert.match(
      source,
      /const competitors = businessCompetitorLandscapeState\s*\n\s*\? businessCompetitorLandscapeState\.competitors\.map/,
      `${name} must still read the canonical structured state directly, unchanged by this ticket`
    );
  }
  assert.match(pdfButtonSource, /const structuredState = readBusinessCompetitorLandscapeState\(report\.metadata\);/);
});

// --- Requirement E: AI Executive Insight / presentation headings ---------

test("requirement E: #69A-15C's AI Executive Insight guard is fully intact in all three renderers -- this ticket must not weaken it", () => {
  for (const [name, source] of [["Planner.tsx", plannerSource], ["page.tsx", pageSource], ["ReportPdfButton.tsx", pdfButtonSource]]) {
    const labels = extractCompetitorFieldLabels(source);
    assert.ok(labels.map((l) => l.toLowerCase()).includes("ai executive insight"), `${name} must still guard against "AI Executive Insight"`);
    assert.match(source, /lowerTrimmed === "ai executive insight" \|\| lowerTrimmed === "AI Yönetici İçgörüsü"\.toLowerCase\(\)/);
  }
});

function extractCompetitorFieldLabels(source) {
  const startMatch = source.match(/const competitorFieldLabels = \[/);
  assert.notEqual(startMatch, null);
  const start = startMatch.index;
  const end = source.indexOf("];", start);
  const arrayLiteralSource = source.slice(start, end + 2);
  const evaluated = new Function(`${arrayLiteralSource}\nreturn competitorFieldLabels;`);
  return evaluated();
}

// --- Requirement F: legacy prose-only reports remain safe -----------------

test("requirement F: Tier 1 (labeled-line prose parse) still works unchanged for a legacy report -- buildBusinessCompetitorLandscapeState is untouched by this ticket", () => {
  const laBelledLine =
    "COMPETITOR: Arbitrary Legacy Co | TYPE: Direct competitor | POSITIONING: legacy positioning text | STRENGTHS: legacy strength | WEAKNESSES: legacy weakness | THREAT: Low";
  const state = buildBusinessCompetitorLandscapeState(laBelledLine);
  assert.ok(state);
  assert.equal(state.competitors[0].company, "Arbitrary Legacy Co");
});

// --- Requirement G: empty evidence stays honest ---------------------------

test("requirement G: zero real competitors in the structured response still resolves to null (never an empty-but-truthy state, never a fabricated placeholder row) -- the renderer's existing empty-state message is untouched", () => {
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse([]), null);
  assert.equal(buildBusinessCompetitorLandscapeStateFromStructuredResponse(undefined), null);

  for (const source of [plannerSource, pageSource]) {
    assert.match(source, /No competitor data could be validated for this market yet\./);
    assert.match(source, /\{competitors\.length > 0 \? \(/);
  }
});

// --- Requirement H: Market Intelligence untouched -------------------------

test("requirement H: no Market Intelligence file, and no MI-specific competitor function, carries a #69A-16 marker", () => {
  for (const relativePath of [
    "app/lib/ai/market-intelligence-graph.ts",
    "app/lib/ai/vendor-intelligence.ts",
    "app/lib/ai/vendor-discovery.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-16/);
  }
  const isImplausibleCompetitorNamePdfStart = pdfButtonSource.match(/function isImplausibleCompetitorNamePdf\(/);
  assert.ok(isImplausibleCompetitorNamePdfStart);
});

// --- Requirement J: canonical authority/financial/decision unchanged -----

test("requirement J: no canonical decision/confidence/evidence-provenance/TAM-SAM-SOM/financial/Unit-Economics/Founder-Readiness/PDF-numeric file carries a #69A-16 marker", () => {
  for (const relativePath of [
    "app/lib/report-presentation.ts",
    "app/lib/report-engine/executive-decision-brief.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/report-consistency-validation.ts",
    "app/lib/report-investment-score.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-16/);
  }
});

test("requirement J: plan-executor.ts's #69A-16 changes are confined to the new mapping-requirement prompt paragraph and the cache-contract version bump -- no change to canonical financial/decision computation functions", () => {
  const markerCount = (planExecutorSource.match(/#69A-16/g) || []).length;
  assert.ok(markerCount >= 1, "expected at least one #69A-16 marker documenting the change");
  assert.doesNotMatch(planExecutorSource, /#69A-16[\s\S]{0,400}canonicalFinancialAssumptions =/);
});
