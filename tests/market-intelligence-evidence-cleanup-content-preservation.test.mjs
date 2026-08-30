import assert from "node:assert/strict";
import test from "node:test";
import { normalizePdfText } from "../app/lib/pdf-normalization.mjs";
import { sanitizeInternalResearchDiagnostics } from "../app/lib/report-output-sanitization.ts";

// TASK #27D -- Fix the content-loss regression caused by evidence-status
// cleanup in the REAL Market Intelligence PDF.
//
// ROOT CAUSE (confirmed live against the real persisted report, id
// 4c0b5786-357c-4927-b7ff-3d38664b6495): Task #27B's
// presentUnverifiedEvidenceStatus (pdf-normalization.mjs) relabels raw
// "[Unverified reference]"/"(unverified)" markers into the professional,
// investor-facing phrase "(Evidence status: Unverified)". That phrase
// contains the substring "status:", which is an EXACT match for a
// completely separate, pre-existing mechanism:
// sanitizeInternalResearchDiagnostics's internalResearchDiagnosticPattern
// (report-output-sanitization.ts), whose generic key-value branch
// (originally `\b(?:provider|query|result|reason|status)\s*[:=|]`, with
// no anchor) is meant to strip genuine research-pipeline debug lines like
// "provider=tavily query=... result=failed". Because that branch had no
// anchor, it also matched "status:" appearing naturally in the MIDDLE of
// a real, substantive sentence -- so every line carrying the new
// professional label was misclassified as internal diagnostic noise and
// deleted by sanitizeInternalResearchDiagnostics's per-line filter. When
// EVERY line of a field shared the label (Major Players, Competitive
// Landscape, TAM/SAM/SOM), the whole field collapsed to the generic
// fallback disclaimer. When only SOME lines had it (numbered lists like
// Barriers, where only some items had an unresolved citation), only those
// individual items were silently dropped -- exactly the reported
// "Barriers now contains only items 3 and 5" symptom.
//
// FIX: internalResearchDiagnosticPattern's generic key-value branch is
// anchored to the start of the line (matching how every genuine
// diagnostic line the pipeline actually emits is shaped, and how
// internalRoutingMetadataPattern already anchors its own metadata-heading
// detection). Genuine diagnostic lines like "provider=tavily query=..."
// still match (the key sits at the line's own start); the same words
// appearing naturally mid-sentence, as in "(Evidence status: Unverified)",
// no longer do. This is a detection-precision fix only -- no content is
// ever fabricated, no persisted report is rewritten, and the canonical
// decision/TAM-SAM-SOM calculation logic is untouched.

// Real persisted-report content for the 8 sections named in the ticket,
// captured verbatim (pre-normalization, raw "[Unverified reference]"
// markers as actually stored) from report id
// 4c0b5786-357c-4927-b7ff-3d38664b6495 via a live Supabase read during
// this task's investigation.
const realSections = {
  "Competitive Landscape":
    "Market structure: commercial CLM market in U.S.\nshows active specialist vendors (Ironclad, Evisort, LawGeex, DocuSign CLM) with AI features and procurement footprints [Unverified reference][Unverified reference][Unverified reference][Unverified reference].\nCompetitive intensity: moderate-to-high—feature parity increasing as multiple vendors announce AI engines (convergence on extraction, clause scoring) [Unverified reference][Unverified reference].\nPositioning clusters: (a) AI-first CLM (Evisort, LawGeex), (b) integrated workflow + eSignature (Ironclad, DocuSign CLM) [Unverified reference][Unverified reference][Unverified reference].\nEntry barriers: data quality, model trust, and procurement listings; switching costs: moderate due to repository migration and workflow reconfiguration.\nDifferentiation levers: vertical-specific compliance modules, demonstrable accuracy metrics, and procurement-ready pricing/contract terms.\nCompetitive implication: an entrant must show measurable AI accuracy and procurement-readiness to win mid-market accounts.\n(116 words)",
  "Major Players":
    "Only evidence-supported major players in the supplied registry: Ironclad — product pages and pricing plan page indicate CLM + AI assistant + eSignature positioning; public pricing not fixed on site [Unverified reference].\nEvisort — publishes an AI engine and contract LLM, positioning as AI-first CLM/contract intelligence [Unverified reference][Unverified reference].\nDocuSign CLM — appears in state procurement pricing (South Carolina), showing public-sector purchasing routes and bundled eSignature/CLM offerings [Unverified reference].\nLawGeex — advertises AI contract-review capabilities (product landing) and positions on automated review [Unverified reference].\nEvidence strength varies: Ironclad and Evisort have strongest product-page evidence [Unverified reference][Unverified reference]; DocuSign procurement price list proves buyability in public sector [Unverified reference]; LawGeex marketing evidences capability but fewer independent metrics [Unverified reference].\n(118 words)",
  "TAM / SAM / SOM":
    "Planning Estimate (all figures labeled [Estimated]): Basis: Emergen Research U.S.\nCLM 2024 endpoint USD 1.5B (used because it is U.S.-specific and CLM-focused) [Unverified reference].\nTAM [Estimated]: USD 1.5 billion (U.S., 2024 baseline from Emergen Research) [Unverified reference].\nSAM [Estimated]: USD 375 million — explicit Planning inputs: serviceable mid‑market share = 25% of TAM (assumption stated due to lack of mid‑market-only disaggregation in sources).\nSOM: Not established — no defensible obtainable-share, penetration rate, or win-rate evidence found in the registry; hence SOM requires validation via market-access metrics (sales cycle win rates, reachable-account lists, annual revenue Market sources).\nAssumptions and gaps: SAM assumes 25% serviceability (assumption).\nTo validate SOM, obtain win-rate and reachable-account capacity evidence (sales / procurement pilots) and mid-market spend-per-customer Market sources.\n(139 words)",
  Barriers:
    "1) SOM / penetration uncertainty — no defensible obtainable-share evidence in registry; this is the single largest strategic barrier to confident go/no-go [, R12].\n2) Trust/accuracy requirements — buyers require verifiable accuracy and traceability for AI outputs; vendors must publish metrics or certification [Unverified reference][Unverified reference].\n3) Integration and migration cost — migration from repositories/workflows creates switching friction.\n4) Procurement and certification — mid-market public procurement routes exist but require supplier qualification (DocuSign SC shows process) [Unverified reference].\n5) Competitive bundling — incumbents bundling CLM+eSignature compress price differentiation.\nStructural barriers (data quality, procurement) may ease with certifications and transparent accuracy reporting.\n(118 words)",
  Opportunities:
    "1) Mid-market focused pricing and packaged compliance modules: registry shows enterprise vendors but limited mid-market pricing—opportunity to offer clear, procurement-friendly line-items for mid-sized firms [Unverified reference][Unverified reference].\n2) Vertical regulatory templates (healthcare, manufacturing): vendors emphasize use cases but verticalized compliance modules are less visible in public evidence [Unverified reference][Unverified reference].\n3) Public-sector supplier listing and buyable pricing: state procurement evidence (DocuSign SC) demonstrates a path to scale via public frameworks [Unverified reference].\n4) Measurable accuracy benchmarking: few vendors publish independent accuracy metrics—providing third-party validated accuracy can be a differentiation.\nEach opportunity addresses buyer procurement friction or unmet mid-market needs.\n(120 words)",
  Threats:
    "1) Commoditization of core extraction as many vendors add similar AI features — likely pressure on feature pricing and margins (vendor announcements show convergence) [Unverified reference][Unverified reference].\n2) Platform concentration — large platform bundles (eSignature + CLM) may lock buyers into incumbents with procurement listing advantages (DocuSign) [Unverified reference].\n3) Regulatory or liability concerns about AI-driven legal advice — could increase compliance costs for vendors; no definitive regulatory change in registry but buyer caution is noted in buyer guides [Unverified reference].\n4) Data constraints and model risk — poor training data reduces accuracy, harming adoption.\nEach threat raises the cost of differentiation or increases sales friction.\n(108 words)",
  "Industry Trends":
    "1) Generative AI integration into CLM: vendors publicly describe AI engines/LLMs for contract tasks (Evisort, LawGeex) — drives automation gains and faster reviews [Unverified reference][Unverified reference].\n2) Procurement and public-sector listing: states publish CLM/eSignature price schedules (DocuSign SC), lowering procurement friction for vendors that secure listings [Unverified reference].\n3) Vendor consolidation and feature bundling: established CLM vendors emphasize AI assistants plus eSignature bundles (Ironclad), compressing feature-differentiation windows [Unverified reference].\n4) Demand from legal operations for measurable ROI: buyer guides and industry surveys suggest legal ops adoption criteria emphasize accuracy, traceability, and compliance reporting (ISG, ACC sources in registry) [Unverified reference][Unverified reference].\nEach trend materially raises buyer willingness to buy AI CLM or increases competitive pressure to certify accuracy and procurement eligibility.\n(124 words)",
  "Market Drivers":
    "1) Productivity and cost reduction from AI-assisted review—vendors and market reports emphasize automation ROI (Evisort, Emergen Research) [Unverified reference][Unverified reference].\n2) Regulatory and compliance complexity—growing need for contract-level compliance monitoring increases demand for automated rule engines (buyer guides) [Unverified reference].\n3) Procurement liquidity—public procurement schedules and vendor listings lower purchase friction for vendors that qualify (DocuSign SC example) [Unverified reference].\n4) Vendor productization of AI—commercial AI engines from multiple vendors expand buyer options and accelerate adoption [Unverified reference][Unverified reference].\nEach driver increases addressable mid‑market demand and shortens sales cycles when accuracy and procurement readiness are proven.\n(103 words)",
};

function runPipeline(raw) {
  return sanitizeInternalResearchDiagnostics(normalizePdfText(raw));
}

function countNonEmptyLines(value) {
  return value.split("\n").filter((line) => line.trim().length > 0).length;
}

test("1. evidence-marker cleanup preserves surrounding sentence content", () => {
  const raw =
    "Ironclad leads on enterprise deals with strong AI positioning [Unverified reference].";
  const after = runPipeline(raw);
  assert.match(after, /^Ironclad leads on enterprise deals with strong AI positioning \(Evidence status: Unverified\)\.$/);
});

test("2. numbered lists retain every legitimate item (Barriers, Opportunities, Threats, Industry Trends, Market Drivers)", () => {
  const listSections = [
    "Barriers",
    "Opportunities",
    "Threats",
    "Industry Trends",
    "Market Drivers",
  ];
  for (const title of listSections) {
    const raw = realSections[title];
    const before = raw.match(/^\d+\)/gm) || [];
    const after = runPipeline(raw).match(/^\d+\)/gm) || [];
    assert.deepEqual(
      after,
      before,
      `${title}: every numbered item present before normalization must survive it`
    );
    assert.ok(before.length >= 4, `${title}: fixture must actually contain a numbered list`);
  }
});

test("3. Major Players content survives normalization", () => {
  const raw = realSections["Major Players"];
  const after = runPipeline(raw);
  assert.doesNotMatch(
    after,
    /generic validation disclaimer|does not contain a definitive conclusion/i,
    "Major Players must not collapse to the generic fallback disclaimer"
  );
  for (const vendor of ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"]) {
    assert.match(after, new RegExp(vendor), `${vendor} must still be present after normalization`);
  }
  // TASK #28 -- may gain exactly one extra line (a single consolidated
  // evidence-status disclosure replacing several repeated inline labels);
  // it must never lose a line of real content, so >= (not ===) is the
  // correct invariant now.
  assert.ok(countNonEmptyLines(after) >= countNonEmptyLines(raw), "line count must not decrease");
});

test("4. Competitive Landscape content survives normalization", () => {
  const raw = realSections["Competitive Landscape"];
  const after = runPipeline(raw);
  assert.doesNotMatch(
    after,
    /No competitor data could be validated for this market yet/,
    "Competitive Landscape must not fall back to the empty-competitor placeholder"
  );
  assert.match(after, /Market structure: commercial CLM market/);
  assert.match(after, /Differentiation levers: vertical-specific compliance modules/);
  assert.ok(countNonEmptyLines(after) >= countNonEmptyLines(raw), "line count must not decrease");
});

test("5. TAM/SAM/SOM numeric values survive normalization", () => {
  const raw = realSections["TAM / SAM / SOM"];
  const after = runPipeline(raw);
  assert.doesNotMatch(
    after,
    /Additional market validation is required before sizing can be confirmed/,
    "TAM/SAM/SOM must not collapse to the generic sizing-unavailable placeholder"
  );
  assert.match(after, /USD 1\.5 billion/);
  assert.match(after, /USD 375 million/);
  assert.match(after, /25% of TAM/);
  assert.ok(countNonEmptyLines(after) >= countNonEmptyLines(raw), "line count must not decrease");
});

test("6. professional evidence labels remain without raw artifacts", () => {
  for (const [title, raw] of Object.entries(realSections)) {
    const after = runPipeline(raw);
    assert.doesNotMatch(after, /\[Unverified reference\]/, `${title}: no raw bracket artifact may remain`);
    assert.doesNotMatch(after, /\(unverified\)/i, `${title}: no raw parenthetical marker may remain`);
    assert.doesNotMatch(after, /(?<!\w)\*(?!\w)/, `${title}: no dangling standalone asterisk may remain`);
  }
});

test("7. exact real persisted report retains substantive content across all affected sections", () => {
  const fallbackPhrases = [
    "No competitor data could be validated for this market yet",
    "Additional market validation is required before sizing can be confirmed",
    "does not contain a definitive conclusion",
  ];
  for (const [title, raw] of Object.entries(realSections)) {
    const before = raw;
    const after = runPipeline(raw);

    for (const phrase of fallbackPhrases) {
      assert.ok(
        !after.includes(phrase) || before.length < 80,
        `${title}: must not collapse to a generic fallback when substantive real content exists`
      );
    }

    assert.ok(
      after.length > before.length * 0.85,
      `${title}: normalization must not shrink real content by more than the marker-relabeling itself accounts for (before=${before.length}, after=${after.length})`
    );
    assert.ok(
      countNonEmptyLines(after) >= countNonEmptyLines(before),
      `${title}: no line may be silently dropped`
    );
  }
});

test("regression fixture: the exact Major Players shape that previously collapsed entirely must now survive intact", () => {
  // This is the literal shape that empirically reproduced the bug during
  // investigation: every line of a real, substantive field ending in the
  // relabeled evidence marker, which the unanchored diagnostic pattern
  // used to strip as if it were a research-pipeline debug dump.
  const raw =
    "Ironclad — product pages indicate CLM positioning; public pricing not fixed on site (Evidence status: Unverified).\n" +
    "Evisort — publishes an AI engine and contract LLM (Evidence status: Unverified).\n" +
    "DocuSign CLM — appears in state procurement pricing (Evidence status: Unverified).\n" +
    "LawGeex — advertises AI contract-review capabilities (Evidence status: Unverified).";
  const after = sanitizeInternalResearchDiagnostics(raw);
  assert.equal(after, raw, "already-normalized content with the professional label must pass through unchanged");
});

test("genuine research-pipeline diagnostic dumps are still removed (no regression to Task #9's original fix)", () => {
  const raw = [
    "[Unknown] property status could not be verified from external sources.",
    'provider=tavily query="test query" result=failed reason=Request was aborted',
    "Research attempts",
    "provider disabled",
  ].join("\n");
  const after = sanitizeInternalResearchDiagnostics(raw);
  assert.doesNotMatch(after, /provider=|query=|result=failed|Request was aborted|provider disabled|Research attempts/i);
  assert.match(after, /does not contain a definitive conclusion\.$/);
});

test("a genuine diagnostic line still matches when the key sits at the very start of the line", () => {
  assert.match("status=failed for endpoint X", /^\s*(?:provider|query|result|reason|status)\s*[:=|]/i);
});

test("the same word does not match when it appears mid-sentence, as in the real evidence label", () => {
  const line =
    "Ironclad leads with enterprise deals (Evidence status: Unverified).";
  assert.doesNotMatch(
    line,
    /^\s*(?:provider|query|result|reason|status)\s*[:=|]/i
  );
});
