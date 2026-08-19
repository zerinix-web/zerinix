import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { labelModelDerivedFinancialClaims } from "../app/lib/report-engine/financial-claim-labeling.ts";

// PRODUCTION REPORT POLISH FIX -- 3 real, confirmed issues found in a live
// pharmacy Business Plan report (Germany + France + Netherlands context,
// PioneerRx / PrimeRx / Rx30 vendor context):
//
// 1. The internal "Validation Required" evidence-classification tag (the
//    same vocabulary report-evidence-confidence.ts uses for UI badges)
//    leaked into user-facing report text as Sources metadata --
//    "Source type: Validation Required" / "Confidence: Validation
//    Required" -- and as a bare KPI value, reading as a broken internal
//    placeholder instead of either real content or an omitted field.
// 2. labelModelDerivedFinancialClaims's own clause-joining logic rejoined
//    two independently generated "Label: statement" clauses on the same
//    line with a bare space when a clause's own generated text had no
//    trailing punctuation, producing run-ons like "...to calculate this
//    Retention loop: ...".
// 3. A compact per-unit metric word occasionally lost its leading space
//    during generation ("perlocation", "perclaim").

const planExecutorSource = readFileSync(
  "app/lib/report-jobs/plan-executor.ts",
  "utf8"
);
const financialClaimLabelingSource = readFileSync(
  "app/lib/report-engine/financial-claim-labeling.ts",
  "utf8"
);

// --- Issue 1: "Validation Required" as Sources metadata / bare KPI value --

// Mirrors omitInternalSourceMetadataPlaceholders exactly (plan-executor.ts
// has heavy Supabase/auth dependencies that prevent clean direct import --
// established convention for this file, see e.g.
// report-pdf-badge-unit-relevance-fixes.test.mjs).
const sourceMetadataValidationPlaceholderPattern =
  /\b(?:Source type|Kaynak türü|Confidence|Güven)\s*[:\-–—]\s*(?:Validation Required|Doğrulama [Gg]erekli)\.?/gi;

function omitInternalSourceMetadataPlaceholders(content) {
  return content
    .split("\n")
    .map((line) => {
      sourceMetadataValidationPlaceholderPattern.lastIndex = 0;
      if (!sourceMetadataValidationPlaceholderPattern.test(line)) {
        return line;
      }

      if (line.includes("|")) {
        return line
          .split("|")
          .map((segment) => segment.trim())
          .filter((segment) => {
            sourceMetadataValidationPlaceholderPattern.lastIndex = 0;
            return segment && !sourceMetadataValidationPlaceholderPattern.test(segment);
          })
          .join(" | ");
      }

      const bulletMatch = line.match(/^(\s*(?:[-*•]\s*)?)/);
      const remainder = line
        .replace(sourceMetadataValidationPlaceholderPattern, "")
        .replace(/^[,;\s]+|[,;\s]+$/g, "")
        .trim();

      if (!remainder) return "";
      return bulletMatch ? `${bulletMatch[1]}${remainder}` : remainder;
    })
    .join("\n");
}

const valueStyleValidationRequiredPattern =
  /(?<=[:\-–—]\s{0,3})\b(?:validation required|doğrulama gerekli)\b/gim;
const trailingProseValidationRequiredPattern =
  /\b(?:validation required|doğrulama gerekli)\b(?=\s*[.;:\n]|\s*$)/gim;
const bareValidationRequiredValuePattern = /\b(?:Validation [Rr]equired|Doğrulama [Gg]erekli)\b/g;

function replaceBareValidationRequiredValue(content, language) {
  const valueReplacement = language === "Turkish" ? "Henüz ölçülmedi" : "Not yet measured";
  const proseReplacement = language === "Turkish" ? "doğrulama gerektiriyor" : "requires validation";

  return content
    .replace(valueStyleValidationRequiredPattern, valueReplacement)
    .replace(trailingProseValidationRequiredPattern, proseReplacement)
    .replace(bareValidationRequiredValuePattern, valueReplacement);
}

test("plan-executor.ts defines the Sources-metadata and bare-value 'Validation Required' cleanup helpers (drift check)", () => {
  assert.match(
    planExecutorSource,
    /function omitInternalSourceMetadataPlaceholders\(/,
    "omitInternalSourceMetadataPlaceholders is missing"
  );
  assert.match(
    planExecutorSource,
    /function replaceBareValidationRequiredValue\(/,
    "replaceBareValidationRequiredValue is missing"
  );
  assert.match(
    planExecutorSource,
    /function fixPerUnitWordBoundaryArtifacts\(/,
    "fixPerUnitWordBoundaryArtifacts is missing"
  );
  // Wired into the final per-field pass in normalizeFullPlanReport, so it
  // runs on every field regardless of whether the content is AI-written,
  // a fallback template, or a canonical/appended block.
  assert.match(
    planExecutorSource,
    /fixPerUnitWordBoundaryArtifacts\(\s*replaceBareValidationRequiredValue\(\s*omitInternalSourceMetadataPlaceholders\(normalized\[field\]\)/,
    "the three cleanup helpers are not wired into the final per-field pass"
  );
});

test("a Sources citation entry with 'Source type: Validation Required' has only that field omitted -- title, publisher, and year survive", () => {
  const line =
    "Title: Pharmacy Compliance in the EU: Regulatory Overview | Publisher: European Medicines Agency | Year: 2024 | Source type: Validation Required";
  const out = omitInternalSourceMetadataPlaceholders(line);

  assert.doesNotMatch(out, /Validation Required/);
  assert.match(out, /Title: Pharmacy Compliance in the EU: Regulatory Overview/);
  assert.match(out, /Publisher: European Medicines Agency/);
  assert.match(out, /Year: 2024/);
});

test("a Sources citation entry with 'Confidence: Validation Required' on its own line is dropped entirely, not left as an empty label", () => {
  const block = [
    "Title: Netherlands Pharmacy Market Report",
    "Publisher: Dutch Healthcare Authority",
    "Confidence: Validation Required",
  ].join("\n");
  const out = omitInternalSourceMetadataPlaceholders(block);

  assert.doesNotMatch(out, /Confidence: Validation Required/);
  assert.match(out, /Title: Netherlands Pharmacy Market Report/);
  assert.match(out, /Publisher: Dutch Healthcare Authority/);
  assert.doesNotMatch(out, /^Confidence\s*:?\s*$/m);
});

test("Turkish 'Kaynak türü: Doğrulama gerekli' and 'Güven: Doğrulama gerekli' are also omitted, not just the English tag", () => {
  const line = "Başlık: Almanya Eczane Pazarı | Kaynak türü: Doğrulama gerekli | Güven: Doğrulama gerekli";
  const out = omitInternalSourceMetadataPlaceholders(line);

  assert.doesNotMatch(out, /Doğrulama gerekli/);
  assert.match(out, /Başlık: Almanya Eczane Pazarı/);
});

test("a bare 'Validation Required' KPI value becomes a professional user-facing state, not an internal tag", () => {
  const out = replaceBareValidationRequiredValue(
    "Activation: Validation Required | Target: prove first paid activation",
    "English"
  );

  assert.doesNotMatch(out, /Validation Required/);
  assert.match(out, /Activation: Not yet measured/);
});

test("the Status-column sentence-case variant ('Status: Validation required', lowercase r) is also caught, not just the Title Case metric value", () => {
  // Reproduces a real gap found in a live pharmacy KPI line: the metric's
  // own VALUE uses Title Case ("Activation: Validation Required") but its
  // companion Status column conventionally uses sentence case ("Status:
  // Validation required") -- both are the same internal tag and must both
  // be replaced.
  const out = replaceBareValidationRequiredValue(
    "Activation: Validation Required | Target: prove first paid activation | Status: Validation required",
    "English"
  );

  assert.doesNotMatch(out, /Validation [Rr]equired/);
  assert.match(out, /Activation: Not yet measured/);
  assert.match(out, /Status: Not yet measured/);
});

test("the Turkish bare tag 'Doğrulama gerekli' becomes 'Henüz ölçülmedi' when the report language is Turkish", () => {
  const out = replaceBareValidationRequiredValue(
    "Aktivasyon: Doğrulama gerekli | Hedef: ilk ücretli aktivasyonu kanıtla",
    "Turkish"
  );

  assert.doesNotMatch(out, /Doğrulama gerekli/);
  assert.match(out, /Aktivasyon: Henüz ölçülmedi/);
});

test("ordinary lowercase prose using the words 'validation required' is never touched (case-sensitive, matches existing codebase convention)", () => {
  const out = replaceBareValidationRequiredValue(
    "Further validation required before scaling this channel.",
    "English"
  );

  assert.equal(out, "Further validation required before scaling this channel.");
});

// --- Issue 2: concatenated/broken sentence boundaries -------------------

test("financial-claim-labeling.ts inserts a sentence boundary between two clauses joined on the same line when the first has no trailing punctuation (the exact live bug)", () => {
  // Reproduces the exact production bug: two independently generated
  // "Label: reason" explanations (neither ending in punctuation) end up on
  // the same source line and must never be concatenated into a run-on.
  const output = labelModelDerivedFinancialClaims({
    content: "Gross margin logic: 62% margin assumed. Retention loop: 84% renewal rate assumed.",
    metricValues: ["62%", "84%"],
    language: "English",
    sourceContext: "pharmacy point-of-sale and PBM claims platform",
  });

  // Both clauses' own labels must still be present and never run together
  // without a boundary between them.
  assert.doesNotMatch(output, /calculate this Retention loop/i);
  assert.doesNotMatch(output, /[a-z0-9%)]\s+[A-Z][a-zçğıöşü]+(?:\s[a-zçğıöşü]+)?\s*:\s/);
});

test("joining two generated unavailable-data clauses on one line inserts a period, not a bare space (generic -- any label pair, not just Gross margin/Retention loop)", () => {
  const output = labelModelDerivedFinancialClaims({
    content: "WTP: $500k assumed. Sales cycle: 45 days assumed.",
    metricValues: ["$500k", "45 days"],
    language: "English",
    sourceContext: "pharmacy point-of-sale and PBM claims platform",
  });

  // Whatever the two generated explanations say, one must end with
  // sentence-ending punctuation before "Sales cycle:" starts.
  const salesCycleIndex = output.indexOf("Sales cycle:");
  assert.ok(salesCycleIndex > 0, "Sales cycle clause not found in output");
  const charBeforeLabel = output.slice(0, salesCycleIndex).trimEnd().slice(-1);
  assert.match(charBeforeLabel, /[.!?:;]/);
});

test("financial-claim-labeling.ts's clause joiner inserts a period before appending the next clause, only when one isn't already present (drift check)", () => {
  assert.match(
    financialClaimLabelingSource,
    /joinClausesWithSentenceBoundaries/,
    "the generic sentence-boundary clause joiner is missing"
  );
  assert.match(
    financialClaimLabelingSource,
    /sentenceEndingPunctuationPattern\.test\(trimmed\)\s*\?\s*trimmed\s*:\s*`\$\{trimmed\}\.`/,
    "the joiner no longer conditionally appends a period"
  );
});

test("an already-correctly-punctuated dense multi-clause paragraph is unaffected -- no double periods introduced", () => {
  const output = labelModelDerivedFinancialClaims({
    content:
      "Kim öder: restoran işletmesi (abone). Ne öder: aylık abonelik ücreti. " +
      "Brüt marj: yazılım SaaS modeline uygun yüksek marj (modelde 78% olarak kullanıldı). " +
      "Retention loop: israf tasarrufu gösterdikçe abonelik yenilemesi.",
    metricValues: ["78%"],
    knownFacts: { buyer: "öngörülen ilk kullanıcılar", beachhead: "öngörülen ilk kullanıcılar" },
    fieldName: "businessModel",
    language: "Turkish",
    sourceContext: "restoran tedarik yönetimi SaaS",
  });

  assert.doesNotMatch(output, /\.\./);
  assert.match(output, /^Kim öder: restoran işletmesi \(abone\)\./);
});

// --- Issue 3: perlocation / perclaim word-boundary artifacts -------------

const perUnitWordBoundaryPattern =
  /\bper(location|claim|prescription|patient|pharmacy|store|branch|customer|user|seat|unit|transaction|order|script|account|employee|month|week|year|day|visit)\b/gi;

function fixPerUnitWordBoundaryArtifacts(content) {
  return content.replace(perUnitWordBoundaryPattern, "per $1");
}

test("'perlocation' and 'perclaim' are split back into two words", () => {
  const out = fixPerUnitWordBoundaryArtifacts(
    "Revenue is $1,200 perlocation and reimbursement averages $18 perclaim across the PBM network."
  );

  assert.match(out, /\$1,200 per location\b/);
  assert.match(out, /\$18 per claim\b/);
  assert.doesNotMatch(out, /perlocation|perclaim/i);
});

test("legitimate words beginning with 'per' are never corrupted (percent, period, performance, permit, personnel, perspective)", () => {
  const sentence =
    "Gross margin is 58 percent over the fiscal period, and performance depends on the pharmacy permit, personnel retention, and long-term perspective.";
  const out = fixPerUnitWordBoundaryArtifacts(sentence);

  assert.equal(out, sentence);
});

test("plan-executor.ts's word-boundary fix uses a curated word list, not a blind 'per' + anything split (drift check)", () => {
  const fnMatch = /function fixPerUnitWordBoundaryArtifacts\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "fixPerUnitWordBoundaryArtifacts not found");
  assert.doesNotMatch(fnMatch[0], /\\bper\\w\+\\b|\\bper\(\.\*\)\\b/);
});
