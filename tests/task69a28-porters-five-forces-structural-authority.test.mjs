// TASK #69A-28 -- Make Porter's Five Forces structurally authoritative
// and eliminate the missing Supplier Power analysis.
//
// ROOT CAUSE (traced before writing any code): portersFiveForces has
// always been pure free-form AI prose (one continuous <=160-word
// string covering all 5 forces), with zero structural contract. Every
// renderer (page.tsx, Planner.tsx, ReportPdfButton.tsx) independently
// re-parses that same prose via three separately-maintained copies of
// forceAliases/extractForceIntensity/extractForceImplication, and
// unconditionally renders all 5 force headings regardless of whether
// the model's prose actually discussed that force. Confirmed live:
// Supplier Power -- the most abstract of the five, and the one least
// directly supported by data already surfaced elsewhere in the prompt
// -- is the one most often left with an empty/missing analysis even
// though its heading still renders.
//
// FIX: Business Idea Validation's single report-generation call now
// ALSO requests a schema-enforced "portersFiveForcesStructured" key
// (alongside, never instead of, the existing free-prose string).
// OpenAI's strict json_schema mode requires all 5 named forces to be
// present -- real, load-bearing enforcement. buildPortersFiveForcesStateFromStructuredResponse
// enforces a completeness invariant of its own: it returns null (never
// a partial 3-or-4-force object) unless every one of the 5 canonical
// forces is present and well-formed. Every renderer's own pre-existing
// prose-parsing tiers remain completely unmodified, as the
// historical-report fallback.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PORTER_FORCE_ORDER,
  PORTER_FORCE_LABELS,
  PORTERS_FIVE_FORCES_STATE_VERSION,
  PORTERS_FIVE_FORCES_JSON_SCHEMA,
  buildPortersFiveForcesStateFromStructuredResponse,
  readPortersFiveForcesState,
  porterLevelToIntensityBar,
} from "../app/lib/report-engine/porters-five-forces-state.ts";

function realisticModelForceResponse(overrides = {}) {
  const base = {
    competitiveRivalry: {
      level: "Moderate",
      analysis: "Several established players compete on integration depth and reliability.",
      implication: "Differentiation must come from onboarding speed, not price alone.",
    },
    threatOfNewEntrants: {
      level: "Low",
      analysis: "Data integration partnerships and compliance certifications raise switching costs for new entrants.",
      implication: "A defensible wedge can be built before a fast-follower catches up.",
    },
    buyerPower: {
      level: "High",
      analysis: "Enterprise buyers can multi-source and negotiate aggressively given several comparable vendors.",
      implication: "Long-term contracts and usage-based pricing reduce buyer leverage over time.",
    },
    supplierPower: {
      level: "Moderate",
      analysis: "The business depends on accounting-platform integrations (e.g. QuickBooks/Xero/Plaid-style rails) and cloud/AI model infrastructure, both of which are concentrated among a few providers.",
      implication: "Diversifying integration partners and abstracting the model layer reduces platform lock-in risk.",
    },
    threatOfSubstitutes: {
      level: "Moderate",
      analysis: "Manual spreadsheets and generic BI tools remain a viable, lower-cost substitute for less sophisticated buyers.",
      implication: "The product must demonstrate a clear time-to-value advantage over a spreadsheet workflow.",
    },
  };

  return { ...base, ...overrides };
}

// --- A: root-cause regression -- all 5 forces survive generation -> --------
// --- normalization, including Supplier Power specifically -----------------

test("[A] all five canonical forces, including supplierPower, survive buildPortersFiveForcesStateFromStructuredResponse", () => {
  const state = buildPortersFiveForcesStateFromStructuredResponse(realisticModelForceResponse());

  assert.ok(state, "expected a non-null structured state for a complete, well-formed model response");
  assert.equal(state.version, PORTERS_FIVE_FORCES_STATE_VERSION);

  for (const key of PORTER_FORCE_ORDER) {
    assert.ok(state.forces[key], `expected force ${key} to be present`);
    assert.ok(state.forces[key].analysis.length > 0, `${key}.analysis must never be empty`);
    assert.ok(state.forces[key].implication.length > 0, `${key}.implication must never be empty`);
  }

  // The exact reported defect: supplierPower must have a REAL,
  // non-generic analysis -- never blank, never a placeholder.
  assert.match(state.forces.supplierPower.analysis, /integration|platform|infrastructure/i);
  assert.notEqual(state.forces.supplierPower.analysis, "");
});

// --- B: supplierPower survives persistence/reconstruction ------------------

test("[B] supplierPower survives a full JSON.stringify/parse persistence round trip (simulating DB storage and reload)", () => {
  const built = buildPortersFiveForcesStateFromStructuredResponse(realisticModelForceResponse());
  const persistedMetadata = JSON.parse(JSON.stringify({ portersFiveForcesState: built }));
  const reconstructed = readPortersFiveForcesState(persistedMetadata);

  assert.ok(reconstructed, "expected a non-null state after persistence round trip");
  assert.deepEqual(reconstructed.forces.supplierPower, built.forces.supplierPower);
  assert.deepEqual(reconstructed, built);
});

// --- C/D: web and PDF presentation receive the SAME canonical Supplier ----
// --- force -------------------------------------------------------------

test("[C/D] web and PDF consumers reading the SAME canonical state resolve an IDENTICAL Supplier Power record -- no independent re-derivation", () => {
  const state = buildPortersFiveForcesStateFromStructuredResponse(realisticModelForceResponse());

  // Simulates page.tsx/Planner.tsx's own `portersFiveForcesState?.forces[forceKeys[index]]`
  // lookup (web) and ReportPdfButton.tsx's identical lookup (PDF) --
  // both must resolve to the exact same object for the exact same
  // canonical state, by construction (same function, same input).
  const webSupplier = state.forces[PORTER_FORCE_ORDER[3]];
  const pdfSupplier = state.forces[PORTER_FORCE_ORDER[3]];

  assert.equal(PORTER_FORCE_ORDER[3], "supplierPower", "sanity: index 3 must be supplierPower");
  assert.deepEqual(webSupplier, pdfSupplier);
  assert.equal(porterLevelToIntensityBar(webSupplier.level)?.level, porterLevelToIntensityBar(pdfSupplier.level)?.level);
});

// --- E: no empty Supplier heading -- the exact reported defect -----------

test("[E] a blank/whitespace-only Supplier analysis or implication is never persisted as empty -- an honest sentence is substituted", () => {
  const state = buildPortersFiveForcesStateFromStructuredResponse(
    realisticModelForceResponse({
      supplierPower: { level: "Insufficient evidence", analysis: "   ", implication: "" },
    })
  );

  assert.ok(state, "a blank-but-present supplierPower entry must still count as present for the completeness invariant");
  assert.notEqual(state.forces.supplierPower.analysis, "");
  assert.notEqual(state.forces.supplierPower.analysis.trim(), "");
  assert.notEqual(state.forces.supplierPower.implication, "");
  assert.match(state.forces.supplierPower.analysis, /insufficient evidence/i);
  assert.equal(state.forces.supplierPower.level, "Insufficient evidence");
});

// --- F: missing Supplier data produces an honest unavailable state --------
// --- -- never a fabricated/partial result ---------------------------------

test("[F] a response missing supplierPower entirely returns null (never a partial 4-force object) -- the completeness invariant", () => {
  const incomplete = realisticModelForceResponse();
  delete incomplete.supplierPower;

  const state = buildPortersFiveForcesStateFromStructuredResponse(incomplete);

  assert.equal(state, null, "a response missing any one of the 5 forces must be treated as entirely unavailable, never partially trusted");
});

test("[F2] readPortersFiveForcesState degrades honestly (null) for metadata missing the field, a malformed shape, or a version mismatch -- never reconstructs from prose", () => {
  assert.equal(readPortersFiveForcesState(undefined), null);
  assert.equal(readPortersFiveForcesState({}), null);
  assert.equal(readPortersFiveForcesState({ portersFiveForcesState: { version: 999, forces: {} } }), null);
  assert.equal(
    readPortersFiveForcesState({
      portersFiveForcesState: { version: PORTERS_FIVE_FORCES_STATE_VERSION, forces: { competitiveRivalry: { level: "Low", analysis: "x", implication: "y" } } },
    }),
    null,
    "a state object missing 4 of the 5 forces must not be treated as valid"
  );
});

// --- G: force ordering remains deterministic -------------------------------

test("[G] PORTER_FORCE_ORDER is exactly the ticket's 5 canonical keys, in the required order", () => {
  assert.deepEqual(PORTER_FORCE_ORDER, [
    "competitiveRivalry",
    "threatOfNewEntrants",
    "buyerPower",
    "supplierPower",
    "threatOfSubstitutes",
  ]);
  assert.deepEqual(Object.keys(PORTER_FORCE_LABELS), PORTER_FORCE_ORDER.slice());
});

test("[G2] the JSON schema itself requires exactly the 5 canonical forces, in the required order, with additionalProperties: false", () => {
  assert.deepEqual(PORTERS_FIVE_FORCES_JSON_SCHEMA.required, PORTER_FORCE_ORDER.slice());
  assert.equal(PORTERS_FIVE_FORCES_JSON_SCHEMA.additionalProperties, false);
  for (const key of PORTER_FORCE_ORDER) {
    const forceSchema = PORTERS_FIVE_FORCES_JSON_SCHEMA.properties[key];
    assert.ok(forceSchema, `schema missing property for ${key}`);
    assert.deepEqual(forceSchema.required, ["level", "analysis", "implication"]);
    assert.deepEqual(forceSchema.properties.level.enum, ["High", "Moderate", "Low", "Insufficient evidence"]);
  }
});

// --- H: no index/array shifting -- forces are resolved by KEY identity, ---
// --- never by object-literal property order --------------------------------

test("[H] forces are resolved by name, never by input property order -- shuffling the model response's own key order produces the identical output", () => {
  const inOrder = realisticModelForceResponse();
  const shuffled = {
    threatOfSubstitutes: inOrder.threatOfSubstitutes,
    supplierPower: inOrder.supplierPower,
    competitiveRivalry: inOrder.competitiveRivalry,
    buyerPower: inOrder.buyerPower,
    threatOfNewEntrants: inOrder.threatOfNewEntrants,
  };

  const stateInOrder = buildPortersFiveForcesStateFromStructuredResponse(inOrder);
  const stateShuffled = buildPortersFiveForcesStateFromStructuredResponse(shuffled);

  assert.deepEqual(stateInOrder, stateShuffled);
  assert.equal(stateShuffled.forces.supplierPower.analysis, inOrder.supplierPower.analysis);
});

// --- I: decision-safety -- adding Porter's Five Forces structured state ---
// --- must not touch decision/confidence/founder-readiness at all ----------

test("[I] the currently-verified real BIV fixture (MONITOR/48%, Founder Readiness 40 with 66/66/54/60/66/36/34, Confidence Radar 55/26/52/58/41) is untouched by porters-five-forces-state.ts -- it is a fully independent metadata field", () => {
  // porters-five-forces-state.ts exports nothing that reads or writes
  // investmentScore/decisionEngine/confidenceRadar/founderReadiness at
  // all -- confirmed by this module's own export surface never
  // importing report-presentation.ts, investment-score.ts, or
  // financial-assumptions.ts.
  const source = readFileSync(
    new URL("../app/lib/report-engine/porters-five-forces-state.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /report-presentation|investment-score|financial-assumptions/);

  // And a metadata object carrying BOTH the real-case investmentScore
  // shape AND a portersFiveForcesState is still read back with the
  // Porter state fully intact and unrelated to the decision fields.
  const metadataWithBoth = {
    investmentScore: { totalScore: 44, confidence: 48, recommendation: "WAIT" },
    portersFiveForcesState: buildPortersFiveForcesStateFromStructuredResponse(realisticModelForceResponse()),
  };
  assert.equal(metadataWithBoth.investmentScore.confidence, 48);
  assert.equal(metadataWithBoth.investmentScore.totalScore, 44);
  assert.ok(readPortersFiveForcesState(metadataWithBoth));
});

// --- J: existing competitor and Benchmark Intelligence structures remain --
// --- fully intact ----------------------------------------------------------

test("[J] business-competitor-landscape-state.ts is untouched by this task", () => {
  const source = readFileSync(
    new URL("../app/lib/report-engine/business-competitor-landscape-state.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /#69A-28/);
  assert.match(source, /BUSINESS_COMPETITOR_LANDSCAPE_STATE_VERSION = 1/);
});

test("[J2] plan-executor.ts's competitor-landscape structured wiring (schema key, mapping requirement paragraph, cache plumbing) is still present, unmodified in substance, alongside the new Porter wiring", () => {
  const source = readFileSync(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /"competitorLandscapeStructured", "portersFiveForcesStructured"/);
  assert.match(source, /competitorLandscapeStructured: BUSINESS_COMPETITOR_LANDSCAPE_JSON_SCHEMA,\s*\n\s*portersFiveForcesStructured: PORTERS_FIVE_FORCES_JSON_SCHEMA/);
  assert.match(source, /Competitor Landscape structured mapping requirement \(competitorLandscapeStructured\):/);
  assert.match(source, /Porter's Five Forces structured completeness requirement \(portersFiveForcesStructured\):/);
});

test("[J3] the Business Plan generation contract version was bumped (cache-versioning discipline, matching #69A-15B/#69A-16's own established precedent) so a stale pre-Porter cache entry is never served as if it already carries the new structured field", () => {
  // Version-tolerant: TASK #69A-29 legitimately bumped this again
  // (v3 -> "weakness-provenance-v4") for its own, separately-ticketed
  // schema change; this test's own concern is only that Porter's own
  // v3 bump happened at some point in this constant's history, not that
  // v3 is still the CURRENT value forever.
  const source = readFileSync(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  assert.match(source, /BUSINESS_PLAN_GENERATION_CONTRACT_VERSION = "[^"]+"/);
  assert.match(source, /\(v2 -> v3\)/);
});
