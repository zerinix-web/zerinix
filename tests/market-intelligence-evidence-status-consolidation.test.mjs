import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizePdfText,
  presentUnverifiedEvidenceStatus,
  consolidateRepeatedEvidenceStatusLabels,
} from "../app/lib/pdf-normalization.mjs";

// TASK #28 -- Replace repetitive "Evidence status: Unverified" noise with
// professional evidence-status presentation in the REAL Market
// Intelligence report/PDF.
//
// TRACE: raw "[Unverified reference]"/"(unverified)" markers are written
// into report content by the model at generation time, persisted as-is,
// then relabeled into "(Evidence status: Unverified)" by
// presentUnverifiedEvidenceStatus every time normalizePdfText runs --
// both at generation/persist time (route.ts's sanitizeMarketReportContent)
// and again at render time (ReportPdfButton.tsx and Planner.tsx both call
// normalizePdfText on every section field before drawing/displaying it).
// Task #27B deliberately made that relabeling apply to EVERY occurrence,
// unconditionally, specifically to preserve per-claim distinction in a
// mixed section (see that fix's own comment in pdf-normalization.mjs).
// The real regression this task fixes is cosmetic, not semantic: fields
// like Major Players/CAGR/Market Drivers/Industry Trends in the real
// persisted report (id 4c0b5786-357c-4927-b7ff-3d38664b6495) end nearly
// every line with the IDENTICAL label (up to 9 times in one field), with
// no verified/[R#]-cited claim anywhere in the same field to distinguish
// from -- so the repetition discloses nothing a single, section-level
// sentence wouldn't. FIX: consolidateRepeatedEvidenceStatusLabels
// (pdf-normalization.mjs), wired into normalizePdfText's own return
// chain, strips the per-claim label and appends ONE professional
// disclosure sentence, but ONLY when (a) the label repeats 2+ times in
// the field, AND (b) the field contains no resolved citation
// ("[R12]" or bare "R12", or "[Verified]") anywhere -- a field with even
// one resolved citation is left completely untouched, so a genuinely
// mixed section keeps its exact per-claim labels exactly as Task #27B
// established.

const majorPlayersRaw =
  "Ironclad — product pages indicate CLM positioning; public pricing not fixed on site [Unverified reference].\n" +
  "Evisort — publishes an AI engine and contract LLM [Unverified reference].\n" +
  "DocuSign CLM — appears in state procurement pricing [Unverified reference].\n" +
  "LawGeex — advertises AI contract-review capabilities [Unverified reference].\n" +
  "Evidence strength varies: Ironclad and Evisort have strongest product-page evidence [Unverified reference][Unverified reference]; DocuSign procurement price list proves buyability in public sector [Unverified reference]; LawGeex marketing evidences capability but fewer independent metrics [Unverified reference].";

const cagrRaw =
  "Defensible CAGR evidence: Emergen Research publishes a U.S. CLM forecast implying ~11.5% CAGR toward 2034 from its 2024 base (USD 1.5B → USD 4.5B) [Unverified reference].\n" +
  "Basis: Emergen Research reported endpoints and period (2024–2034) [Unverified reference].\n" +
  "Use Emergen Research CAGR as the working growth signal for 2027 planning; label it [Estimated] because it is a single-provider forecast applied to mid-market strategy.";

const marketDriversRaw =
  "1) Productivity and cost reduction from AI-assisted review—vendors and market reports emphasize automation ROI (Evisort, Emergen Research) [Unverified reference][Unverified reference].\n" +
  "2) Regulatory and compliance complexity—growing need for contract-level compliance monitoring increases demand for automated rule engines (buyer guides) [Unverified reference].\n" +
  "3) Procurement liquidity—public procurement schedules and vendor listings lower purchase friction for vendors that qualify (DocuSign SC example) [Unverified reference].\n" +
  "4) Vendor productization of AI—commercial AI engines from multiple vendors expand buyer options and accelerate adoption [Unverified reference][Unverified reference].\n" +
  "Each driver increases addressable mid-market demand and shortens sales cycles when accuracy and procurement readiness are proven.";

// Genuinely mixed: item 1 carries a real citation, items 2 and 4 do not.
const barriersMixedRaw =
  "1) SOM / penetration uncertainty — no defensible obtainable-share evidence in registry; this is the single largest strategic barrier to confident go/no-go [R12].\n" +
  "2) Trust/accuracy requirements — buyers require verifiable accuracy and traceability for AI outputs; vendors must publish metrics or certification [Unverified reference].\n" +
  "3) Integration and migration cost — migration from repositories/workflows creates switching friction.\n" +
  "4) Procurement and certification — mid-market public procurement routes exist but require supplier qualification (DocuSign SC shows process) [Unverified reference].\n" +
  "5) Competitive bundling — incumbents bundling CLM+eSignature compress price differentiation.";

// Genuinely mixed via a BARE (unbracketed) citation mention, as Strategic
// Recommendations/Executive Summary/Porter's Five Forces actually do in
// the real report ("see R12, R4, R5").
const execSummaryMixedRaw =
  "Bottom Line — Decision: ENTER the market (evidence-backed growth signal; see R12, R4, R5).\n" +
  "Key Findings — 1) Growth signal is strong [Unverified reference]; 2) Commercial readiness is documented [Unverified reference].\n" +
  "Biggest Opportunity — Rapid AI adoption driven by productivity gains and documented vendor activity (R12, R4, R5).";

test("1. repeated unverified markers in one section collapse to a single professional disclosure", () => {
  const out = normalizePdfText(majorPlayersRaw);
  assert.equal((out.match(/\(Evidence status: Unverified\)/g) || []).length, 0, "no inline label may remain");
  assert.match(out, /Evidence note: Some claims require independent validation\.$/);
  for (const vendor of ["Ironclad", "Evisort", "DocuSign CLM", "LawGeex"]) {
    assert.match(out, new RegExp(vendor), `${vendor} must survive`);
  }
});

test("1b. the same consolidation applies across CAGR and Market Drivers (independently confirmed real fields)", () => {
  for (const raw of [cagrRaw, marketDriversRaw]) {
    const out = normalizePdfText(raw);
    assert.equal((out.match(/\(Evidence status: Unverified\)/g) || []).length, 0);
    assert.match(out, /Evidence note: Some claims require independent validation\.$/);
  }
});

test("2. mixed verified + unverified claims: a field with even one resolved [R#] citation is left completely untouched", () => {
  const out = normalizePdfText(barriersMixedRaw);
  assert.equal((out.match(/\(Evidence status: Unverified\)/g) || []).length, 2, "both per-claim labels must remain, unconsolidated");
  assert.doesNotMatch(out, /Evidence status: several claims|Evidence note: Some claims require independent validation/, "must not add the section-level note to a mixed field");
  assert.match(out, /\[R12\]/, "the resolved citation must survive exactly");
  const items = out.match(/^\d\)/gm) || [];
  assert.equal(items.length, 5, "all 5 numbered items must survive with their original boundaries");
});

test("2b. mixed verified + unverified claims via a BARE (unbracketed) citation mention is also protected", () => {
  const out = normalizePdfText(execSummaryMixedRaw);
  assert.equal((out.match(/\(Evidence status: Unverified\)/g) || []).length, 2, "bare-citation fields must also keep their per-claim labels");
  assert.doesNotMatch(out, /Evidence status: several claims|Evidence note: Some claims require independent validation/);
  assert.match(out, /see R12, R4, R5/);
  assert.match(out, /documented vendor activity \(R12, R4, R5\)/);
});

test("3. valid [R#] citations remain intact in both consolidated and unconsolidated fields", () => {
  const consolidated = normalizePdfText(majorPlayersRaw + " Confirmed in [R3].");
  assert.match(consolidated, /\[R3\]/);
  const mixed = normalizePdfText(barriersMixedRaw);
  assert.match(mixed, /\[R12\]/);
});

test("4. punctuation/boundary cases around the removed label leave clean, grammatical text", () => {
  const cases = [
    ["ends a sentence with a period", "Public pricing not fixed on site [Unverified reference].\nSecond claim here [Unverified reference].", /site\.\nSecond claim here\./],
    ["sits before a semicolon", "First claim [Unverified reference]; second claim continues.\nThird claim [Unverified reference]; fourth continues.", /First claim; second claim continues\.\nThird claim; fourth continues\./],
    ["two adjacent markers on one claim collapse before consolidation", "One claim with two markers [Unverified reference][Unverified reference].\nAnother claim [Unverified reference].", /One claim with two markers\.\nAnother claim\./],
  ];
  for (const [label, input, expected] of cases) {
    const out = normalizePdfText(input);
    assert.match(out, expected, `boundary case failed: ${label} -> "${out}"`);
    assert.doesNotMatch(out, /\s{2,}[.;,]/, `${label}: must not leave a stray double space before punctuation`);
  }
});

test("5. no content loss: every substantive word survives consolidation, only the label text is removed", () => {
  const out = normalizePdfText(majorPlayersRaw);
  const words = ["Ironclad", "Evisort", "DocuSign", "LawGeex", "product-page evidence", "buyability in public sector", "fewer independent metrics"];
  for (const word of words) {
    assert.match(out, new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `"${word}" must survive verbatim`);
  }
});

test("5b. a single (non-repeated) occurrence is left inline exactly as Task #27B established, never dropped or consolidated", () => {
  const single = "Only one unresolved claim here [Unverified reference]. Everything else is plain prose with no other markers at all.";
  const out = normalizePdfText(single);
  assert.equal((out.match(/\(Evidence status: Unverified\)/g) || []).length, 1, "the lone label must remain inline");
  assert.doesNotMatch(out, /Evidence status: several claims/, "a single occurrence is not \"repeated\" and must not be consolidated");
});

test("6. canonical decision text (MONITOR / ENTER / Validation Required) passes through untouched", () => {
  const decisionText = "Canonical decision: MONITOR. Confidence: Validation Required.";
  assert.equal(normalizePdfText(decisionText), decisionText);

  const enterWithMixedEvidence = normalizePdfText(execSummaryMixedRaw);
  assert.match(enterWithMixedEvidence, /Decision: ENTER the market/, "decision wording inside a mixed field must be untouched");
});

test("7. REAL persisted-report shape end to end: uniform field consolidates, mixed field does not, in the same normalizePdfText pass", () => {
  const uniform = normalizePdfText(majorPlayersRaw);
  const mixed = normalizePdfText(barriersMixedRaw);
  assert.doesNotMatch(uniform, /\(Evidence status: Unverified\)/);
  assert.match(uniform, /Evidence note: Some claims require independent validation/);
  assert.match(mixed, /\(Evidence status: Unverified\)/);
  assert.doesNotMatch(mixed, /Evidence status: several claims|Evidence note: Some claims require independent validation/);
});

test("presentUnverifiedEvidenceStatus's own per-marker relabeling behavior is unchanged by this task", () => {
  const out = presentUnverifiedEvidenceStatus("a claim (unverified). b claim (unverified).");
  assert.equal(out, "a claim (Evidence status: Unverified). b claim (Evidence status: Unverified).");
});

test("consolidateRepeatedEvidenceStatusLabels is idempotent on already-consolidated text", () => {
  const once = consolidateRepeatedEvidenceStatusLabels(presentUnverifiedEvidenceStatus(majorPlayersRaw.replace(/\[Unverified reference\]/g, "(unverified)")));
  const twice = consolidateRepeatedEvidenceStatusLabels(once);
  assert.equal(once, twice, "re-running consolidation on already-consolidated text must be a no-op");
});
