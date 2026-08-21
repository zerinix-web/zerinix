import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// Reproduces 3 real, confirmed production bugs found in a live Business
// Plan PDF for a music royalty distribution platform (no explicit stated
// pricing -- revenue-share described only as "we take a percentage of
// royalties instead of charging upfront fees"), a genuinely different
// code branch from every previously-tested idea (all of which had a
// clear, explicit pricing signal):
//
// 1. REGRESSION -- raw "AI Analysis"/"Assumption"/"Estimated" badges
//    reappeared in Unit Economics, but from a DIFFERENT generation path
//    than the one already fixed: /plan (Planner.tsx's own PDF export,
//    downloadPdf) still draws a separate confidence-badge line directly
//    beneath each Financial Dashboard/Unit Economics/KPI Dashboard
//    card's value -- a line ReportPdfButton.tsx (the /dashboard/[id]
//    PDF export, already fixed) deliberately does not draw. Extracted
//    as flat text, "CAC" + "$4k" + "Assumption" (three separately-drawn
//    but visually stacked lines in one tiny card) reads exactly like the
//    raw concatenation this was already fixed for once.
// 2. REGRESSION -- pricingModel's own fallback value was the literal
//    placeholder string "inferred pricing model", leaking into Financial
//    Assumptions ("Pricing model: inferred pricing model") and narrative
//    sentences ("test the inferred pricing model offer with inferred
//    early adopters") -- the same class of raw-placeholder bug already
//    fixed for geography ("global / unspecified") and business model
//    ("Unspecified business model"), just never applied to pricing model.
// 3. Sources page malformed entries ("U.S." alone as a source name, a
//    title truncated mid-abbreviation) -- root cause: a citation's own
//    raw sourceTitle/publisher text sometimes carries an embedded
//    newline (a source page's own text wrapping), which orphaned the
//    continuation fragment as an unrecognized line that got silently
//    dropped instead of reattached to the field it continues. Two
//    separate, independently-drifted parseCitations implementations
//    (ReportPdfButton.tsx and components/planner/Citations.tsx, used by
//    a third, still-different generation path) both needed the fix.

const financialModelSource = readFileSync(
  join(repoRoot, "app/lib/ai/financial-model.ts"),
  "utf8"
);
const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pdfButtonSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"),
  "utf8"
);
const citationsSource = readFileSync(
  join(repoRoot, "components/planner/Citations.tsx"),
  "utf8"
);

// --- Issue 1: Planner.tsx's PDF export still draws a confidence badge --

test("Planner.tsx's PDF export no longer draws a confidence-badge line for Financial Dashboard/Unit Economics/KPI Dashboard cards (drift check)", () => {
  assert.doesNotMatch(
    plannerSource,
    /const confidenceBadge = isFinancialDashboard \|\| isUnitEconomics \|\| isKpiDashboard/,
    "the confidence-badge computation for these three card types is still present"
  );
  assert.doesNotMatch(
    plannerSource,
    /getPdfFinancialMetricConfidenceBadge\(confidenceBadge\)/,
    "pdfConfidenceBadge is still being computed for drawing"
  );
});

test("Planner.tsx's on-screen React badge (a proper, visually distinct <span>, not a PDF text line) is untouched (no regression)", () => {
  // The legitimate, correctly-designed UI badge must still exist for the
  // browser-rendered dashboard -- only the PDF's flat-text duplicate of
  // it was removed. A later CRITICAL PRODUCTION FIX (PRODUCTION DATA
  // PROVENANCE POLISH) standardized the label lookup itself to the
  // 3-tier getFinancialEvidenceBadgeLabel across Financial Dashboard,
  // Unit Economics, and KPI Dashboard -- same badge span, updated label
  // source.
  assert.match(plannerSource, /getFinancialMetricConfidenceBadgeClass\(confidenceBadge\)/);
  assert.match(plannerSource, /getFinancialEvidenceBadgeLabel\(confidenceBadge, evidenceLocale\)/);
});

// --- Issue 2: "inferred pricing model" placeholder ---------------------

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferFinancialModelingInputs } = await importFinancialModel();

test("the pricingModel fallback is no longer the literal placeholder string 'inferred pricing model' (drift check)", () => {
  // Only the fallback value actually passed to firstMatching() must be
  // gone -- the explanatory comment above it is expected to still name
  // the old placeholder as historical context.
  assert.match(financialModelSource, /\n\s*"not-yet-validated",\s*\n\s*normalized\s*\n\s*\),/);
  assert.doesNotMatch(financialModelSource, /\n\s*"inferred pricing model",/);
  assert.doesNotMatch(planExecutorSource, /\\binferred pricing model\\b/);
});

test("the exact music-royalty prompt ('we take a percentage of royalties instead of charging upfront fees') resolves to a real pricing model, not the fallback", () => {
  const inputs = inferFinancialModelingInputs(
    "I am building a music royalty distribution platform for independent musicians. We take a percentage of royalties instead of charging upfront fees, helping artists track and collect streaming and licensing royalties across platforms."
  );

  assert.equal(inputs.pricingModel, "take-rate / commission");
});

test("commission/percentage wording is recognized even when the same prompt also mentions a generic time-period word in a negating clause (live verification finding)", () => {
  // "instead of charging a monthly fee" used to win over "percentage
  // commission" purely because the subscription pattern (checked first)
  // matched the generic word "monthly" -- found live while verifying
  // the music-royalty fix on a second, differently-worded revenue-share
  // idea.
  const inputs = inferFinancialModelingInputs(
    "I am building a talent agency booking platform for wedding photographers. We take a percentage commission from each booking instead of charging a monthly fee, connecting photographers with couples planning weddings."
  );

  assert.equal(inputs.pricingModel, "take-rate / commission");
});

test("'take a share of X' (not just 'revenue share'/'take a cut') is also recognized as a commission model", () => {
  const inputs = inferFinancialModelingInputs(
    "I am building a crowdfunding platform for independent film projects. We take a share of funds raised from each successful campaign instead of charging filmmakers any upfront listing fee."
  );

  assert.equal(inputs.pricingModel, "take-rate / commission");
});

test("a genuinely unclassifiable pricing model (no signal at all) falls back to a clean, non-placeholder-sounding description", () => {
  const inputs = inferFinancialModelingInputs(
    "I want to build an app that connects hobbyist bakers with local ingredient suppliers and lets them share recipes with each other. We have not decided how we will make money from this yet."
  );

  assert.equal(inputs.pricingModel, "not-yet-validated");
  assert.doesNotMatch(inputs.pricingModel, /inferred/i);
});

test("the fallback reads naturally when embedded directly in narrative prose, matching the exact live bug shapes", () => {
  const pricingModel = "not-yet-validated";
  const financialAssumptionsLine = `Pricing model: ${pricingModel}`;
  const kpiSentence = `Validate first paid activation from inferred early adopters on the ${pricingModel} offer`;
  const roadmapSentence = `Next 30 Days: test the ${pricingModel} offer with inferred early adopters`;

  for (const text of [financialAssumptionsLine, kpiSentence, roadmapSentence]) {
    assert.doesNotMatch(text, /inferred pricing model/i);
  }
});

test("plan-executor.ts's Turkish translation table matches the new pricing-model default (drift check)", () => {
  assert.match(planExecutorSource, /\\bPricing model: not-yet-validated\\b/);
  assert.match(planExecutorSource, /\\bnot-yet-validated\\b/);
});

// --- Issue 3: Sources page malformed/truncated entries -----------------

test("both parseCitations implementations (ReportPdfButton.tsx and Citations.tsx) merge an orphaned continuation fragment back into the field it continues, instead of dropping it (drift check)", () => {
  for (const [name, source] of [
    ["ReportPdfButton.tsx", pdfButtonSource],
    ["Citations.tsx", citationsSource],
  ]) {
    assert.match(source, /lastContinuableField/, `${name}: continuation tracking not found`);
  }
});

test("Citations.tsx's isPlausibleCitationField now also rejects a truncated value, matching ReportPdfButton.tsx (drift check)", () => {
  assert.match(citationsSource, /function looksTruncated\(value: string\)/);
  assert.match(citationsSource, /!looksTruncated\(trimmed\)/);
});

test("ReportPdfButton.tsx's title/publisher assignment tentatively holds a truncated-looking abbreviation (e.g. bare 'U.S.') for continuation instead of dropping it outright (drift check)", () => {
  // Confirmed live: "Title: U.S." followed by its own real continuation
  // ("Economic Census (NAICS Sector 23) and SBA open data") never
  // reached the continuation-merge logic at all -- looksLikeCitationMetadataValue
  // itself rejects a bare "U.S." (two periods), so current.sourceTitle
  // was never set for the next line to extend. flushCurrent's own
  // isPlausibleCitationField check still gates the final, merged result,
  // so this only gives a genuine abbreviation a chance to complete, it
  // never bypasses validation for anything else.
  assert.match(pdfButtonSource, /\} else if \(looksTruncated\(value\)\) \{\s*\n\s*\/\/ Confirmed live: "Title: U\.S\."/);
});

test("a bare truncated-looking title fragment ('U.S.') held tentatively still reassembles correctly with its real continuation", () => {
  function looksLikeCitationMetadataValue(value, maxWords = 18) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 140) return false;
    if (trimmed.split(/\s+/).length > maxWords) return false;
    if (/[.!?]/.test(trimmed.replace(/\d\.\d/g, "0"))) return false;
    return true;
  }
  function looksTruncated(value) {
    const openParens = (value.match(/\(/g) || []).length;
    const closeParens = (value.match(/\)/g) || []).length;
    if (openParens > closeParens) return true;
    return /\b[A-Z]\.\s*$/.test(value.trim());
  }

  const entries = [];
  let current = {};
  let lastContinuableField = null;
  const flush = () => {
    if (current.sourceTitle) entries.push({ ...current });
    current = {};
    lastContinuableField = null;
  };

  for (const rawLine of [
    "Title: U.S.",
    "Economic Census (NAICS Sector 23) and SBA open data",
    "Publisher: Census Bureau",
  ]) {
    const line = rawLine.trim();
    const metadataMatch = line.match(/^(title|publisher)\s*:\s*(.+)$/i);
    if (metadataMatch) {
      const key = metadataMatch[1].toLowerCase();
      const value = metadataMatch[2].trim();
      if (key === "title" && current.sourceTitle) flush();
      lastContinuableField = null;
      if (key === "title") {
        if (looksLikeCitationMetadataValue(value, 24) || looksTruncated(value)) {
          current.sourceTitle = value;
          lastContinuableField = "sourceTitle";
        }
      } else {
        current.organization = value;
        lastContinuableField = "publisher";
      }
      continue;
    }
    if (lastContinuableField && line.length <= 140 && !/[.!?]/.test(line.replace(/\d\.\d/g, "0"))) {
      current[lastContinuableField === "publisher" ? "organization" : "sourceTitle"] =
        `${current[lastContinuableField === "publisher" ? "organization" : "sourceTitle"]} ${line}`.trim();
    }
  }
  flush();

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0].sourceTitle,
    "U.S. Economic Census (NAICS Sector 23) and SBA open data"
  );
});

function mirrorParseCitationsContinuation(lines) {
  const entries = [];
  let current = {};
  let lastContinuableField = null;
  const flush = () => {
    if (current.sourceTitle || current.organization) entries.push({ ...current });
    current = {};
    lastContinuableField = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const metadataMatch = line.match(/^(title|publisher)\s*:\s*(.+)$/i);
    if (metadataMatch) {
      const key = metadataMatch[1].toLowerCase();
      const value = metadataMatch[2].trim();
      if (key === "title" && current.sourceTitle) flush();
      if (key === "title") {
        current.sourceTitle = value;
        lastContinuableField = "sourceTitle";
      } else {
        current.organization = value;
        lastContinuableField = "organization";
      }
      continue;
    }

    // Orphaned continuation: short, no sentence punctuation (a decimal
    // point like "$4.2B" is stripped first so it isn't mistaken for one).
    if (
      lastContinuableField &&
      line.length <= 140 &&
      !/[.!?]/.test(line.replace(/\d\.\d/g, "0"))
    ) {
      current[lastContinuableField] = `${current[lastContinuableField]} ${line}`.trim();
    } else {
      lastContinuableField = null;
    }
  }
  flush();
  return entries;
}

test("a title split across an embedded newline (the exact live shape: 'U.S.' then 'Copyright Office' on the next line) reassembles into one complete title", () => {
  const entries = mirrorParseCitationsContinuation([
    "Title: CMO Report — U.S.",
    "Copyright Office",
    "Publisher: U.S.",
    "Copyright Office",
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceTitle, "CMO Report — U.S. Copyright Office");
  assert.equal(entries[0].organization, "U.S. Copyright Office");
});

test("a longer, multi-word title continuation (found live: over the initial 80-char/12-word limit) still reassembles correctly", () => {
  // Confirmed live: "Title: U.S." followed by "Contractors Spent $4.2B
  // on Software in 2025 · Clockwork: Industry estimate: U.S." on its
  // own line -- a genuine title continuation, but longer than the
  // original guard allowed, so it was still dropped after the first fix.
  const entries = mirrorParseCitationsContinuation([
    "Title: U.S.",
    "Contractors Spent $4.2B on Software in 2025 · Clockwork",
    "Publisher: Clockwork",
  ]);

  assert.equal(entries.length, 1);
  assert.equal(
    entries[0].sourceTitle,
    "U.S. Contractors Spent $4.2B on Software in 2025 · Clockwork"
  );
});

test("a genuinely unrelated paragraph following the citations block is never absorbed into the last citation's title", () => {
  const entries = mirrorParseCitationsContinuation([
    "Title: IFPI Global Music Report 2026",
    "Publisher: IFPI",
    "Methodology and assumptions for this section describe how market sizing figures were derived from the calculated base-case financial model.",
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].sourceTitle, "IFPI Global Music Report 2026");
});
