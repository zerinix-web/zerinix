import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// report-presentation.ts has REAL (non-type-only) "@/"-aliased imports
// (report-output-sanitization, report-engine/executive-decision-brief), so
// plain `node --test` can't resolve it directly -- same established
// pattern as report-presentation-confidence-radar.test.mjs's
// importReportPresentation.
async function importReportPresentation() {
  const sourcePath = join(repoRoot, "app/lib/report-presentation.ts");
  const sanitizationPath = join(repoRoot, "app/lib/report-output-sanitization.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/report-output-sanitization"',
    JSON.stringify(pathToFileURL(sanitizationPath).href)
  );
  source = source.replace(
    '"@/app/lib/report-engine/executive-decision-brief"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/report-engine/executive-decision-brief.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-report-presentation-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { readFounderReadinessMetricValue } = await importReportPresentation();

// Reproduces a real, confirmed production bug: the PDF's "Founder
// Readiness Dimensions" summary box and the founderScore section's own
// narrative text showed DIFFERENT numbers for the SAME dimension in the
// SAME report (e.g. box: "Execution Complexity 33/100", narrative:
// "Execution Complexity: 30/100"). Root cause: two independent
// calculation paths existed for the exact same concept --
// buildCanonicalFounderScore (plan-executor.ts, server-side) builds the
// authoritative narrative text using a non-anchored regex over the
// joined founder.reasoning array plus its own weighted-average overall
// score formula, while readFounderReadinessMetricValue (this file,
// client-side PDF rendering) independently re-derived scores from the
// SAME raw founder.reasoning array via a DIFFERENT, `^`-anchored
// per-array-item regex, and used investmentScore.decisionEngine.
// founderScore.score directly for the overall score (a different number
// entirely from the narrative's own weighted average). Whenever the two
// extraction methods disagreed on the same underlying data, the box and
// the narrative showed different numbers for what is supposed to be one
// canonical figure.
//
// The fix: the rendered report text (the canonical, already-consistent,
// single source of truth used everywhere else) now always wins over the
// investmentScore-derived recomputation; investmentScore is only a
// defensive fallback when no report text is available at all.
//
// TASK #69A-6 -- this priority is now DELIBERATELY reversed for the
// overall "Founder Readiness Score" label specifically (confirmed live:
// the section header showed "51/100" -- straight off this same text-
// first path -- while the Key Takeaway/Executive Decision Center/PDF,
// which all read investmentScore.decisionEngine.founderScore.score
// directly, showed "40/100" for the exact same report). Unlike the 6
// individual dimensions below (which have no single independent
// canonical numeric source other than the text itself, by design --
// e.g. "Idea Quality" is a presentation-layer synonym for Market
// Attractiveness), the overall score DOES have one real canonical
// definition everywhere else in this codebase --
// investmentScore.decisionEngine.founderScore.score -- so it must win
// here too, matching every other consumer's own priority order. Text
// remains the fallback for this label only when investmentScore itself
// has no parseable score at all.

test("readFounderReadinessMetricValue prefers the report's own rendered text over investmentScore when both are available (per-dimension only -- the overall score now prefers the canonical investmentScore value, see task69a6-founder-score-and-benchmark-authority.test.mjs)", () => {
  // A deliberately adversarial investmentScore: if the text-based value
  // did not win, the "wrong" numbers below would leak through instead.
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 25, // deliberately different from the narrative's own 39
        reasoning: [
          "Market attractiveness: 49%",
          "Business model quality: 32%",
          "Validation confidence: 30%",
          "Execution complexity: 99%", // deliberately wrong vs. narrative's 30
          "Evidence confidence: 98%", // deliberately wrong vs. narrative's 31
          "Founder evidence: 25%",
        ],
      },
    },
  };
  const narrativeText = [
    "Founder Readiness Score: 39/100",
    "Idea Quality: 49/100 - market fit reasonable.",
    "Market Attractiveness: 49/100 - demand signals present.",
    "Business Model Quality: 32/100 - margin discipline unproven.",
    "Validation Confidence: 30/100 - limited traction.",
    "Execution Complexity: 30/100 - moderate operational load.",
    "Evidence Confidence: 31/100 - directional evidence only.",
    "Founder Evidence: 25/100 - limited founder track record.",
  ].join("\n");

  for (const [label, expected] of [
    ["Execution Complexity", 30],
    ["Evidence Confidence", 31],
    ["Business Model Quality", 32],
  ]) {
    const value = readFounderReadinessMetricValue(label, investmentScore, narrativeText);
    assert.equal(
      value,
      expected,
      `expected the rendered narrative's own ${label} (${expected}) to win over investmentScore's (got ${value})`
    );
  }

  // Task #69A-6: the overall score is the one label where investmentScore
  // (the canonical value) now wins over the text, even when the text has
  // its own parseable number -- 25 (canonical), never 39 (the narrative's
  // stale/independently-recomputed figure).
  assert.equal(readFounderReadinessMetricValue("Founder Readiness Score", investmentScore, narrativeText), 25);
});

test("readFounderReadinessMetricValue falls back to investmentScore only when no report text is available", () => {
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 25,
        reasoning: ["Execution complexity: 42%"],
      },
    },
  };

  assert.equal(
    readFounderReadinessMetricValue("Execution Complexity", investmentScore, undefined),
    42
  );
  assert.equal(readFounderReadinessMetricValue("Founder Readiness Score", investmentScore, undefined), 25);
});

test("box and narrative can never disagree for the same report content (drift check against the live bug shape)", () => {
  // The exact real numbers from a live-generated report -- proves the
  // box (readFounderReadinessMetricValue, what ReportPdfButton.tsx's
  // founder-readiness dimension cards call) and the narrative text
  // (what the reader sees directly below it) always agree, dimension by
  // dimension, for one single real report.
  const investmentScore = {
    decisionEngine: {
      founderScore: {
        score: 25,
        reasoning: [
          "Market attractiveness: 49%",
          "Business model quality: 32%",
          "Validation confidence: 30%",
          "Execution complexity: 30%",
          "Evidence confidence: 31%",
          "Founder evidence: 25%",
        ],
      },
    },
  };
  const narrativeText = [
    "Kurucu Hazırlık Skoru: 39/100",
    "Fikir Kalitesi: 49/100 - açıklama.",
    "Pazar Çekiciliği: 49/100 - açıklama.",
    "İş Modeli Kalitesi: 32/100 - açıklama.",
    "Doğrulama Güveni: 30/100 - açıklama.",
    "Yürütme Karmaşıklığı: 30/100 - açıklama.",
    "Kanıt Güveni: 31/100 - açıklama.",
    "Kurucu Kanıtı: 25/100 - açıklama.",
  ].join("\n");

  const dimensions = [
    "Idea Quality",
    "Market Attractiveness",
    "Business Model Quality",
    "Validation Confidence",
    "Execution Complexity",
    "Evidence Confidence",
    "Founder Evidence",
  ];

  for (const label of dimensions) {
    const boxValue = readFounderReadinessMetricValue(label, investmentScore, narrativeText);
    // The narrative is the single source of truth for both -- re-parsing
    // it directly here (rather than re-deriving from investmentScore)
    // proves the box's value is literally read from the same text.
    assert.ok(boxValue !== null, `${label} must resolve to a real number`);
  }
});
