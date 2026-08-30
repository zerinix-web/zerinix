import assert from "node:assert/strict";
import test from "node:test";
import { normalizePdfText } from "../app/lib/pdf-normalization.mjs";

// TASK #28B -- Finalize premium evidence-status presentation in the REAL
// Market Intelligence PDF.
//
// Two presentation defects remained after Task #28:
//
// DEFECT 1 (confirmed live, report id 4c0b5786-357c-4927-b7ff-3d38664b6495):
// Strategic Recommendations Action 2 still ended with the raw inline
// marker "(Evidence status: Unverified)." embedded inside its own
// sentence. This happened because Action 2, once split out by
// extractRecommendationItems (ReportPdfButton.tsx/Planner.tsx), is
// normalized ALONE (via localizePdfPresentationText's own internal
// normalizePdfText call) -- and Task #28's consolidation only fired at
// 2+ occurrences within the SAME text block. Action 2's own text has
// exactly ONE occurrence, so it never triggered consolidation and stayed
// embedded mid-sentence exactly as Task #27B originally designed for
// ordinary prose. FIX: a structural heuristic
// (recommendationActionShapePattern in pdf-normalization.mjs) detects a
// recommendation action's own distinctive field-value shape ("Owner:",
// "Budget ceiling:", "KPI:", "Success criterion:" -- unique to this one
// context, never ordinary narrative prose elsewhere in the report) and
// lowers the consolidation threshold to 1 occurrence specifically for
// that shape, while every other section keeps the Task #28 threshold of
// 2. A field with its own [R#]/bare-R#/[Verified] citation is still left
// completely untouched either way (requirement 4: preserve claim-level
// distinction where mixed evidence genuinely requires it).
//
// DEFECT 2 (confirmed live): the Task #28 consolidated note --
// "Evidence status: several claims in this section reference vendor or
// public materials that have not been independently verified." -- is
// accurate but reads as mechanical once repeated, verbatim, across most
// sections of the same report. FIX: shortened to a compact, consistent
// label ("Evidence note: Some claims require independent validation."),
// in every supported language, without changing when it fires (still
// only for a field with no citation and 2+, or 1+ for recommendation
// prose, repeated markers) or what it discloses (still an unambiguous
// unresolved-evidence disclosure, never phrased as if anything were
// verified).

const realSections = {
  "Major Players":
    "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site [Unverified reference].\nEvisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence [Unverified reference][Unverified reference].\nDocuSign CLM — appears in state procurement pricing (South Carolina), showing public-sector purchasing routes and bundled eSignature/CLM offerings [Unverified reference].\nLawGeex — advertises AI contract-review capabilities (product landing) and positions on automated review [Unverified reference].\n(118 words)",
  CAGR: "Defensible CAGR evidence: Emergen Research publishes a U.S. CLM forecast implying ~11.5% CAGR toward 2034 from its 2024 base (USD 1.5B → USD 4.5B) [Unverified reference].\nBasis: Emergen Research reported endpoints and period (2024–2034) [Unverified reference].\nUse Emergen Research CAGR as the working growth signal for 2027 planning; label it [Estimated] because it is a single-provider forecast applied to mid-market strategy.",
  "Market Segmentation":
    "Mid-market segment is the largest by count of active AI CLM buyers [Unverified reference].\nEnterprise segment shows the highest average contract value [Unverified reference].",
  "Regional Analysis":
    "U.S. evidence is strongest among the supplied registry [Unverified reference].\nEurope evidence is comparatively thin in the same registry [Unverified reference].",
  "Industry Trends":
    "1) Generative AI integration into CLM: vendors publicly describe AI engines/LLMs for contract tasks (Evisort, LawGeex) — drives automation gains and faster reviews [Unverified reference][Unverified reference].\n2) Procurement and public-sector listing: states publish CLM/eSignature price schedules (DocuSign SC), lowering procurement friction for vendors that secure listings [Unverified reference].\n3) Vendor consolidation and feature bundling: established CLM vendors emphasize AI assistants plus eSignature bundles (Ironclad), compressing feature-differentiation windows [Unverified reference].",
  "Customer Segments":
    "Legal operations teams are the primary buyer persona in the supplied registry [Unverified reference].\nProcurement teams are a secondary influencer persona [Unverified reference].",
  "Market Drivers":
    "1) Productivity and cost reduction from AI-assisted review—vendors and market reports emphasize automation ROI (Evisort, Emergen Research) [Unverified reference][Unverified reference].\n2) Regulatory and compliance complexity—growing need for contract-level compliance monitoring increases demand for automated rule engines (buyer guides) [Unverified reference].\n3) Procurement liquidity—public procurement schedules and vendor listings lower purchase friction for vendors that qualify (DocuSign SC example) [Unverified reference].",
  Barriers:
    "1) SOM / penetration uncertainty — no defensible obtainable-share evidence in registry; this is the single largest strategic barrier to confident go/no-go [, R12].\n2) Trust/accuracy requirements — buyers require verifiable accuracy and traceability for AI outputs; vendors must publish metrics or certification [Unverified reference][Unverified reference].\n3) Integration and migration cost — migration from repositories/workflows creates switching friction.\n4) Procurement and certification — mid-market public procurement routes exist but require supplier qualification (DocuSign SC shows process) [Unverified reference].\n5) Competitive bundling — incumbents bundling CLM+eSignature compress price differentiation.",
  Opportunities:
    "1) Mid-market focused pricing and packaged compliance modules: registry shows enterprise vendors but limited mid-market pricing—opportunity to offer clear, procurement-friendly line-items for mid-sized firms [Unverified reference][Unverified reference].\n2) Vertical regulatory templates (healthcare, manufacturing): vendors emphasize use cases but verticalized compliance modules are less visible in public evidence [Unverified reference][Unverified reference].\n3) Public-sector supplier listing and buyable pricing: state procurement evidence (DocuSign SC) demonstrates a path to scale via public frameworks [Unverified reference].\n4) Measurable accuracy benchmarking: few vendors publish independent accuracy metrics—providing third-party validated accuracy can be a differentiation.",
  Threats:
    "1) Commoditization of core extraction as many vendors add similar AI features — likely pressure on feature pricing and margins (vendor announcements show convergence) [Unverified reference][Unverified reference].\n2) Platform concentration — large platform bundles (eSignature + CLM) may lock buyers into incumbents with procurement listing advantages (DocuSign) [Unverified reference].\n3) Regulatory or liability concerns about AI-driven legal advice — could increase compliance costs for vendors; no definitive regulatory change in registry but buyer caution is noted in buyer guides [Unverified reference].",
};

// The exact real Strategic Recommendations Action 2 shape (Task #28B's
// live defect 1), isolated exactly as extractRecommendationItems would
// hand it to normalizePdfText via localizePdfPresentationText.
const strategicRecommendationAction2 =
  "Accuracy benchmarking engagement — Owner: Head of Product, Budget ceiling: USD 60,000; KPI: independent accuracy Market sources report (clause extraction & risk scoring) across 500 representative contracts; Success criterion: third-party Market sources demonstrating ≥90% extraction F1 or equivalent within 90 days (requirement driven by buyer expectations in vendor docs) (Evidence status: Unverified).";

const strategicRecommendationAction1 =
  "Market-access validation — Owner: Head of Sales (U.S. mid-market), Budget ceiling: USD 80,000; KPI: number of qualified mid-market procurement channels secured; Success criterion: at least one state procurement listing or one reseller agreement signed within 90 days (evidence path: state contract templates like R3).";

const strategicRecommendationAction3 =
  "6-account pilot commitments — Owner: Head of Commercial, Budget ceiling: USD 60,000 (sales support); KPI: signed pilot contracts with 6 U.S. mid-market customers across two verticals; Success criterion: at least 3 pilots convert to paid contracts within 6 months or provide per-account annual revenue benchmarks to validate SOM assumptions.";

test("1. no inline (Evidence status: Unverified) remains in recommendation prose, even for a single occurrence", () => {
  const rendered = normalizePdfText(strategicRecommendationAction2);
  assert.doesNotMatch(rendered, /\(Evidence status: Unverified\)/, "recommendation prose must never carry the raw inline metadata marker");
  assert.doesNotMatch(rendered, /\(unverified\)/i);
  assert.match(rendered, /Owner: Head of Product, Budget ceiling: USD 60,000/, "the action's own instruction text must survive intact");
  assert.match(rendered, /within 90\sdays \(requirement driven by buyer expectations in vendor docs\)\./, "the sentence must read cleanly, without the marker glued onto its end");
  // Requirement: the underlying uncertainty state must not be removed --
  // it is disclosed via the shared compact note instead of embedded
  // inline.
  assert.match(rendered, /Evidence note: Some claims require independent validation\.$/);
});

test("2. repeated long section disclosures are replaced by one compact note, across every audited real section", () => {
  for (const [title, raw] of Object.entries(realSections)) {
    const rendered = normalizePdfText(raw);
    assert.doesNotMatch(
      rendered,
      /Evidence status: several claims in this section reference vendor or public materials/,
      `${title}: the old, long, mechanical disclosure sentence must never appear`
    );
    if (title === "Barriers") {
      // Barriers cites [R12] elsewhere in the field -- mixed evidence, no
      // note, per-claim labels remain (see test 4 below).
      assert.doesNotMatch(rendered, /Evidence note: Some claims require independent validation\./);
      continue;
    }
    assert.match(
      rendered,
      /Evidence note: Some claims require independent validation\.$/,
      `${title}: expected the new compact note to replace repeated per-claim labels`
    );
    assert.equal(
      (rendered.match(/\(Evidence status: Unverified\)/g) || []).length,
      0,
      `${title}: no per-claim label should survive once consolidated`
    );
  }
});

test("3. verified-only sections do not receive an unnecessary evidence warning", () => {
  const fullyVerified =
    "Market structure is well documented: Ironclad leads with enterprise deals [R3]. Evisort differentiates through AI-native analysis [R7]. DocuSign leverages its eSignature base [R9].";
  const rendered = normalizePdfText(fullyVerified);
  assert.doesNotMatch(rendered, /Evidence note:/);
  assert.doesNotMatch(rendered, /Evidence status: Unverified/);
  assert.match(rendered, /\[R3\]/);
  assert.match(rendered, /\[R7\]/);
  assert.match(rendered, /\[R9\]/);
});

test("3b. a section with zero evidence markers at all receives no note", () => {
  const plain = "This is a completely ordinary paragraph with no unresolved claims and no citations at all.";
  assert.equal(normalizePdfText(plain), plain);
});

test("4. mixed evidence remains distinguishable: a field with its own citation keeps its per-claim labels, in both general prose and recommendation-shaped prose", () => {
  const rendered = normalizePdfText(realSections.Barriers);
  assert.equal((rendered.match(/\(Evidence status: Unverified\)/g) || []).length, 2, "items 2 and 4 must each keep their own label");
  assert.match(rendered, /\[R12\]/, "the resolved citation on item 1 must survive");
  assert.doesNotMatch(rendered, /Evidence note:/);

  const mixedRecommendationAction =
    "Accuracy benchmarking engagement — KPI: independent accuracy report demonstrating extraction quality (Evidence status: Unverified); Success criterion: confirmed by prior study [R7] within 90 days.";
  const renderedAction = normalizePdfText(mixedRecommendationAction);
  assert.match(renderedAction, /\(Evidence status: Unverified\)/, "even recommendation-shaped prose keeps its per-claim label when the SAME action also cites a real source");
  assert.match(renderedAction, /\[R7\]/);
  assert.doesNotMatch(renderedAction, /Evidence note:/);
});

test("5. no substantive text is removed by either the recommendation-prose fix or the compact-note rewording", () => {
  const rendered = normalizePdfText(strategicRecommendationAction2);
  for (const phrase of [
    "Accuracy benchmarking engagement",
    "Head of Product",
    "Budget ceiling: USD 60,000",
    "independent accuracy",
    "across 500 representative contracts",
    "third-party",
    "extraction F1",
    "buyer expectations in vendor docs",
  ]) {
    assert.ok(rendered.includes(phrase), `expected "${phrase}" to survive verbatim`);
  }

  for (const [title, raw] of Object.entries(realSections)) {
    const rendered = normalizePdfText(raw);
    const rawWords = raw.replace(/\[Unverified reference\]|\[,?\s*R\d+\]/g, "").split(/\s+/).filter((w) => w.length > 4);
    for (const word of rawWords.slice(0, 15)) {
      assert.ok(rendered.includes(word), `${title}: expected "${word}" to survive`);
    }
  }
});

test("6. all 4 real Strategic Recommendations actions remain intact after both fixes", () => {
  const closingSentence =
    "If all three succeed, scale; if accuracy benchmarks or procurement listing fails, re-evaluate and monitor instead.";
  const items = [
    strategicRecommendationAction1,
    strategicRecommendationAction2,
    strategicRecommendationAction3,
    closingSentence,
  ];
  const rendered = items.map((item) => normalizePdfText(item));
  assert.equal(rendered.length, 4);
  assert.match(rendered[0], /Head of Sales \(U\.S\. mid-market\), Budget ceiling: USD 80,000/);
  assert.doesNotMatch(rendered[1], /\(Evidence status: Unverified\)/);
  assert.match(rendered[1], /Evidence note: Some claims require independent validation\.$/);
  assert.match(rendered[2], /6 U\.S\. mid-market customers across two verticals/);
  assert.match(rendered[3], /if accuracy benchmarks or procurement listing fails/);
  for (const r of rendered) {
    assert.doesNotMatch(r, /\(unverified\)/i);
    assert.doesNotMatch(r, /\*/);
  }
});

test("7. TAM/SAM/SOM numeric values and structure remain intact", () => {
  const tamSamSom =
    "TAM [Estimated]: USD 1.5 billion (U.S., 2024 baseline from Emergen Research) [Unverified reference].\nSAM [Estimated]: USD 375 million — explicit Planning inputs: serviceable mid-market share = 25% of TAM [Unverified reference].\nSOM: Not established — no defensible obtainable-share evidence found in the registry.";
  const rendered = normalizePdfText(tamSamSom);
  assert.match(rendered, /USD 1\.5 billion/);
  assert.match(rendered, /USD 375 million/);
  assert.match(rendered, /25% of TAM/);
  assert.doesNotMatch(rendered, /\(Evidence status: Unverified\)/, "2 occurrences with no citation must consolidate");
  assert.match(rendered, /Evidence note: Some claims require independent validation\.$/);
});

test("8. canonical decision text (MONITOR / Validation Required) passes through untouched by both fixes", () => {
  const decisionText = "Canonical decision: MONITOR. Confidence: Validation Required.";
  assert.equal(normalizePdfText(decisionText), decisionText);

  const withinRecommendation =
    "Recommendation: Enter (evidence supports entering with a validated mid-market penetration plan; see R12, R4, R5). Current decision remains MONITOR pending SOM validation.";
  const rendered = normalizePdfText(withinRecommendation);
  assert.match(rendered, /Current decision remains MONITOR pending SOM validation\./);
  assert.match(rendered, /see R12, R4, R5/);
});

test("9. valid [R#] citations remain unchanged by both fixes, in general prose and recommendation prose", () => {
  const rendered = normalizePdfText(realSections.Barriers);
  assert.match(rendered, /\[R12\]/);

  const recommendationWithCitation = normalizePdfText(strategicRecommendationAction1);
  assert.doesNotMatch(recommendationWithCitation, /\[R3\]/, "Action 1 cites R3 in bare (unbracketed) form in the real report, not bracketed");
  assert.match(recommendationWithCitation, /\bR3\b/, "the bare citation mention itself must survive verbatim");
});
