import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildMarketIntelligenceGraph } from "../app/lib/ai/market-intelligence-graph.ts";
import { stripReportPresentationArtifacts } from "../app/lib/report-engine/report-presentation-sanitizer.ts";

// TASK #54B -- Fix the remaining real-report TAM provenance rendering
// failure that escaped Task #54A.
//
// EXACT RUNTIME PATH THAT ESCAPED TASK #54A: Task #54A's own regression
// tests called buildMarketIntelligenceGraph directly and asserted
// against graph.planningEstimate.formula -- never piping that string
// through the SAME presentation pipeline a real report actually goes
// through before a reader sees it. That real pipeline is:
//
//   buildMarketIntelligenceGraph (this repo's market-intelligence-graph.ts)
//     -> report.sections[].content (persisted, includes "Formula: ...")
//     -> app/dashboard/report-utils.ts's normalizeReport
//     -> sanitizeReportSectionsForPresentation (report-presentation-sanitizer.ts)
//     -> stripReportPresentationArtifacts, called UNCONDITIONALLY on
//        EVERY section, for EVERY report type (that function's own
//        comment: "[R#]/evidence-registry citation tags... Applied
//        once, here, unconditionally, regardless of... report type")
//     -> web (page.tsx) and PDF (ReportPdfButton.tsx) both read this
//        SAME normalized report.
//
// stripReportPresentationArtifacts's citationBracketTagPattern strips
// ANY "[R\d+]"-shaped bracket as internal notation -- a deliberate,
// pre-existing, CORRECT behavior for every other report kind, whose
// generation prompts write "[R#]" purely as internal scaffolding never
// meant to reach the reader. Task #54A's own fix produced a perfectly
// well-formed "addressable buyers from [R7] (other)" -- but this
// downstream, universal sanitizer removes "[R7]" unconditionally
// anyway, leaving exactly the same dangling "addressable buyers from
// (other)" the ticket reported, regardless of whether the id was ever
// empty. Reproduced below with a FULLY VALID, non-empty evidence id --
// the exact real-report shape Task #54A's own tests never exercised.
//
// FIX: a bracketed [R#] citation can never survive to the reader in
// TAM/SAM/SOM prose, by design, so it must never be constructed there
// at all. formatMarketSizingSourceClause/formatMarketSizingBareCitation
// (market-intelligence-graph.ts, the single, canonical place every
// citation clause in this file's basis/formula construction already
// routes through, per Task #54A) now unconditionally return "" --
// dropping the citation-bracket fragment entirely. The evidence CLASS
// annotation (e.g. "(government statistics)") is a plain parenthetical,
// not a "[R#]"-shaped bracket, so it is untouched by
// citationBracketTagPattern and remains a genuine, meaningful, and
// SURVIVING source label.

const graphSource = readFileSync(
  new URL("../app/lib/ai/market-intelligence-graph.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/dashboard/[id]/page.tsx", import.meta.url), "utf8");
const plannerSource = readFileSync(new URL("../components/Planner.tsx", import.meta.url), "utf8");
const pdfButtonSource = readFileSync(new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url), "utf8");

const checkedAt = "2026-08-02T00:00:00.000Z";

function evidence({
  id,
  field,
  claim,
  value = claim,
  url,
  sourceType = "official company source",
  authorityLevel = "secondary",
  confidence = 76,
  qualityScore = 58,
  publishedDate = "2025-06-01",
  label = "Verified from external source",
}) {
  return {
    id,
    field,
    claim,
    value,
    label,
    sourceTitle: `${id} source`,
    publisher: `${id} publisher`,
    url,
    sourceType,
    authorityLevel,
    confidence,
    publishedDate,
    lastChecked: checkedAt,
    supportingData: [claim],
    impact: "neutral",
    impactReason: "Supports market-sizing coverage.",
    qualityScore,
    qualityRationale: "Directly relevant public source with valid provenance.",
  };
}

const prompt = "Analyze the fleet telematics software market.";

// The exact real-report shape: fully valid, non-empty, well-formed
// evidence ids reaching the bottom-up calculation -- Task #54A's own
// "empty id" fixture never exercised this path through the real
// presentation pipeline.
function buildRealShapeGraph() {
  return buildMarketIntelligenceGraph(
    {
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    prompt
  );
}

function assertNoMalformedProvenanceArtifacts(text) {
  assert.doesNotMatch(text, /from \(/, "must never leave a dangling 'from (' with no citation before the evidence-class parenthetical");
  assert.doesNotMatch(text, /from\.(?:\s|$)/, "must never leave a dangling 'from.' with nothing after it");
  assert.doesNotMatch(text, /from\s*×/, "must never leave a dangling 'from' immediately before the × operator");
  assert.doesNotMatch(text, /\[\]/, "must never leave an empty bracket pair");
  assert.doesNotMatch(text, /\[undefined\]|\[null\]/i, "must never leave an undefined/null source label");
  assert.doesNotMatch(text, /\[R\d+\]/, "must never embed a bracketed [R#] citation at all -- it cannot survive the real presentation pipeline");
}

// --- 1/2. Reproduce the ACTUAL real-report shape that escaped Task #54A ---

test("TASK #54B-1: reproduces the REAL runtime failure with a FULLY VALID, non-empty evidence id -- Task #54A's fix alone still produced 'from (class)' / dangling 'from.' once piped through the real presentation sanitizer", () => {
  const graph = buildRealShapeGraph();
  assert.ok(graph.planningEstimate);
  const rawFormula = graph.planningEstimate.formula;

  // Sanity: the raw, pre-sanitization formula genuinely has no bracket
  // at all any more (TASK #54B's own fix), so there is nothing left for
  // the downstream sanitizer to damage in the first place.
  assert.doesNotMatch(rawFormula, /\[R\d+\]/);

  const presented = stripReportPresentationArtifacts(rawFormula);
  assert.equal(presented, rawFormula, "TASK #54B: sanitization must be a complete no-op on this text now -- there is no bracket left for it to touch");
  assertNoMalformedProvenanceArtifacts(presented);
});

test("TASK #54B-2: the real bottomUp shape renders a clean, truthful, neutral formula sentence -- 'addressable buyers (evidence class) x annualized price', never a fake or empty attribution", () => {
  const graph = buildRealShapeGraph();
  const presented = stripReportPresentationArtifacts(graph.planningEstimate.formula);
  assert.match(presented, /^TAM = addressable buyers \(government statistics\) × annualized price\./);
});

// --- 5. Prove the defect class is impossible across every method branch ---

test("TASK #54B-5: topDown, triangulated, bottomUp, and proxy-pricing methods all produce provenance text with no malformed artifacts after the real presentation sanitizer runs", () => {
  const scenarios = [
    {
      name: "topDown",
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/programs-surveys/fleet-telematics.html",
          claim: "The US fleet telematics software market size is $1.2 billion in 2026.",
        }),
      ],
    },
    {
      name: "triangulated",
      evidence: [
        evidence({
          id: "R1",
          field: "market_size",
          url: "https://www.census.gov/programs-surveys/fleet-telematics.html",
          claim: "The US fleet telematics software market size is $80 million in 2026.",
        }),
        evidence({
          id: "R2",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R3",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    {
      name: "bottomUp",
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Typical annual price for fleet telematics subscriptions is $2,000 per fleet.",
        }),
      ],
    },
    {
      name: "proxy pricing",
      evidence: [
        evidence({
          id: "R1",
          field: "market_demand",
          url: "https://www.census.gov/data/tables/fleet-business-population.html",
          claim: "There are an addressable business population of 40,000 commercial fleet operators in the target geography.",
        }),
        evidence({
          id: "R2",
          field: "product_evidence",
          url: "https://example-vendor.com/pricing",
          claim: "Average contract value for adjacent fleet software is $5,000 per deal.",
        }),
      ],
    },
  ];

  for (const scenario of scenarios) {
    const graph = buildMarketIntelligenceGraph({ evidence: scenario.evidence }, prompt);
    assert.ok(graph.planningEstimate, `${scenario.name}: expected a planning estimate`);
    const presented = stripReportPresentationArtifacts(graph.planningEstimate.formula);
    assertNoMalformedProvenanceArtifacts(presented);
  }
});

// --- 4. No renderer may invent provenance; web/PDF consume the same state ---

test("TASK #54B-4: no render surface independently reconstructs a TAM formula/provenance sentence -- web and PDF both read the SAME already-sanitized, already-persisted section content", () => {
  for (const [name, source] of [
    ["page.tsx", pageSource],
    ["Planner.tsx", plannerSource],
    ["ReportPdfButton.tsx", pdfButtonSource],
  ]) {
    assert.doesNotMatch(source, /addressable buyers/i, `${name}: must not independently construct TAM formula text`);
    assert.doesNotMatch(source, /function formatMarketSizingSourceClause|function formatMarketSizingBareCitation/, `${name}: must not duplicate the citation-clause builders`);
  }
});

test("TASK #54B-4 (drift check): both citation-clause builders are defined exactly once, unconditionally return an empty string, and every basis/formula construction site still routes through them", () => {
  const sourceClauseDef = graphSource.match(/function formatMarketSizingSourceClause\([\s\S]*?\n\}/)[0];
  const bareCitationDef = graphSource.match(/function formatMarketSizingBareCitation\([\s\S]*?\n\}/)[0];
  assert.match(sourceClauseDef, /return "";/);
  assert.match(bareCitationDef, /return "";/);
  const buildPlanningEstimateSource = graphSource.match(/function buildPlanningEstimate\([\s\S]*?\n  return \{[\s\S]*?\n  \};\n\}/)[0];
  assert.doesNotMatch(
    buildPlanningEstimateSource,
    /from \[\$\{|\(addressable buyers \[\$\{|annualized price \[\$\{/,
    "no remaining raw bracket interpolation at any TAM/SAM/SOM basis/formula construction site"
  );
  const sourceClauseCallCount = (buildPlanningEstimateSource.match(/formatMarketSizingSourceClause\(/g) || []).length;
  const bareCitationCallCount = (buildPlanningEstimateSource.match(/formatMarketSizingBareCitation\(/g) || []).length;
  assert.ok(sourceClauseCallCount >= 6, "every 'from [id]'-shaped citation site (topDown, bottomUp, proxy, conflict note, SAM, SOM) must still route through the builder");
  assert.ok(bareCitationCallCount >= 2, "the triangulated branch's two bare buyer/price citations must still route through the builder");
});

// --- 6. Decision/confidence/ENTER eligibility/evidence gaps/closure plan preserved ---

test("TASK #54B-6: this fix is confined to TAM/SAM/SOM citation-clause text -- it does not touch numeric TAM/SAM/SOM calculation, method/tier selection, or any decision-layer concept", () => {
  const graph = buildRealShapeGraph();
  assert.equal(graph.planningEstimate.method, "bottomUp");
  assert.equal(graph.planningEstimate.tier, "supportedEstimate");
  assert.match(graph.planningEstimate.tam, /\$80(?:\.0)?M/, "the numeric TAM figure is completely unaffected by this presentation-only fix");

  assert.doesNotMatch(graphSource, /assessMarketEntryConfidence/);
  assert.doesNotMatch(graphSource, /resolveMarketIntelligenceEnterEligibility/);
  assert.doesNotMatch(graphSource, /resolveMarketIntelligenceDecisionGateEvaluations/);
  assert.doesNotMatch(graphSource, /decisionCriticalEvidence/);
});

test("TASK #54B-6 (continued): SAM/SOM's own honest fallback text (Validation Required-equivalent) is unaffected -- a report with no serviceable/obtainable-share evidence still withholds a numeric SAM/SOM exactly as before", () => {
  const graph = buildRealShapeGraph();
  assert.equal(graph.planningEstimate.samMethod, "defaultAssumption");
  assert.equal(graph.planningEstimate.somStatus, "pending");
  assert.match(graph.planningEstimate.som, /obtainable-share|penetration|win-rate/i);
});
