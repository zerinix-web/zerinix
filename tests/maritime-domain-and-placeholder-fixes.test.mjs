import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

// CRITICAL PRODUCTION BUG -- 2 real, confirmed issues found in a live
// Business Plan report for a maritime/shipping fleet-operations AI
// platform (Singapore, Greece, Norway, UAE):
//
// 1. Domain contamination: a commercial shipping AI platform was
//    misclassified as "cybersecurity" because inferIndustryKey's
//    cybersecurity pattern matched the bare word "compliance" (from
//    "monitors regulatory compliance" -- an ordinary feature mention any
//    regulated industry makes, not a signal the business IS a
//    cybersecurity company), and this pattern was checked before the
//    logistics/maritime pattern in firstMatching's array order. Since
//    Financial Assumptions, Benchmark Intelligence, SWOT, and every
//    canonical builder all read the SAME context.inputs.industry /
//    context.benchmark derived from this one function, the
//    misclassification propagated Cybersecurity terminology into every
//    section.
// 2. Placeholder leakage: removePlaceholderKpiValues (the repair pass for
//    a malformed AI-written "1"/"1/1" KPI placeholder) substituted the
//    literal internal tags "Validation Required" / "validation test
//    required" -- introducing the exact raw-sounding placeholder text
//    this report must never expose, instead of removing it.

const planExecutorSource = readFileSync(
  join(repoRoot, "app/lib/report-jobs/plan-executor.ts"),
  "utf8"
);

async function importFinancialModel() {
  const sourcePath = join(repoRoot, "app/lib/ai/financial-model.ts");
  const benchmarksPath = join(repoRoot, "app/lib/ai/industry-benchmarks.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/industry-benchmarks"',
    JSON.stringify(pathToFileURL(benchmarksPath).href)
  );
  source = source.replace(
    '"@/app/lib/ai/company-lifecycle"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/company-lifecycle.ts")).href)
  );

  const dir = mkdtempSync(join(tmpdir(), "zerinix-financial-model-"));
  const outPath = join(dir, "financial-model.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { inferIndustryKey } = await importFinancialModel();
const { getIndustryBenchmarks } = await import(
  pathToFileURL(join(repoRoot, "app/lib/ai/industry-benchmarks.ts")).href
);

const maritimePrompt =
  "I want to build a B2B SaaS platform that helps commercial shipping companies optimize fleet operations using AI. The platform predicts vessel maintenance, optimizes fuel consumption, automates voyage planning, monitors regulatory compliance, and integrates with existing maritime ERP systems. The target customers are medium and large shipping companies operating across Singapore, Greece, Norway, and the United Arab Emirates. Revenue will come from annual enterprise subscriptions and usage-based analytics.";

// --- Issue 1: maritime domain routing / benchmark selection -------------

test("the exact live maritime/shipping fleet-operations prompt no longer classifies as cybersecurity (the exact live bug)", () => {
  assert.notEqual(inferIndustryKey(maritimePrompt), "cybersecurity");
  assert.equal(inferIndustryKey(maritimePrompt), "logistics");
});

test("benchmark selection: the maritime prompt's benchmark label and basis never mention cybersecurity", () => {
  const benchmark = getIndustryBenchmarks(inferIndustryKey(maritimePrompt));
  assert.doesNotMatch(benchmark.label, /cybersecurity/i);
  assert.doesNotMatch(benchmark.benchmarkBasis, /cybersecurity/i);
  assert.match(benchmark.label, /logistics/i);
});

test("financial benchmark selection: a shorter maritime prompt mentioning only 'shipping' and 'fleet' still routes to logistics, not cybersecurity", () => {
  assert.equal(
    inferIndustryKey("An AI platform for fleet operations and shipping logistics."),
    "logistics"
  );
});

test("maritime-specific vocabulary (vessel, voyage planning, maritime, port operations, cargo) is recognized even without the word 'shipping'", () => {
  const prompts = [
    "AI-driven vessel maintenance prediction for maritime operators.",
    "A voyage planning optimization tool for fleet operators.",
    "Cargo tracking and port operations software for terminal operators.",
  ];
  for (const prompt of prompts) {
    assert.equal(inferIndustryKey(prompt), "logistics", `"${prompt}" should route to logistics`);
  }
});

test("regulatory compliance mentioned by other industries no longer misroutes to cybersecurity (generic, not maritime-specific)", () => {
  assert.equal(
    inferIndustryKey("A medical device company focused on regulatory compliance for hospitals"),
    "healthcare"
  );
  assert.notEqual(
    inferIndustryKey("A logistics platform that monitors regulatory compliance for freight carriers"),
    "cybersecurity"
  );
});

test("genuine cybersecurity businesses still correctly classify as cybersecurity (narrowing the pattern must not remove real detection)", () => {
  const genuineCyberPrompts = [
    "A cybersecurity platform for enterprise threat detection",
    "A managed detection and response (MDR) service for SMBs",
    "An endpoint security platform for enterprises",
    "A SOC as a service company for mid-market businesses",
    "A fraud detection platform for online payment processors",
  ];
  for (const prompt of genuineCyberPrompts) {
    assert.equal(inferIndustryKey(prompt), "cybersecurity", `"${prompt}" should still route to cybersecurity`);
  }
});

test("inferIndustryKey's cybersecurity pattern no longer matches bare 'compliance'/'security' (drift check)", () => {
  const financialModelSource = readFileSync(
    join(repoRoot, "app/lib/ai/financial-model.ts"),
    "utf8"
  );
  const cyberPatternMatch = /\[\/\\b\(cybersecurity[^\]]*\)\\b\/, "cybersecurity"\]/.exec(
    financialModelSource
  );
  assert.ok(cyberPatternMatch, "cybersecurity pattern not found in financial-model.ts");
  assert.doesNotMatch(cyberPatternMatch[0], /\|compliance\|/);
  assert.doesNotMatch(cyberPatternMatch[0], /\|security\|/);
  assert.doesNotMatch(cyberPatternMatch[0], /\|threat\|/);
  assert.doesNotMatch(cyberPatternMatch[0], /\|fraud\|/);
});

test("SWOT generation: buildCanonicalSwot interpolates context.inputs.industry directly, never re-scanning the prompt for industry keywords itself (drift check)", () => {
  const fnMatch = /function buildCanonicalSwot\([\s\S]*?\n\}/.exec(planExecutorSource);
  assert.ok(fnMatch, "buildCanonicalSwot not found");
  assert.match(fnMatch[0], /\$\{context\.inputs\.industry\}/);
  // Must not independently re-classify the business from raw prompt text --
  // the single source of truth is the already-computed context.inputs.industry.
  assert.doesNotMatch(fnMatch[0], /\bcybersecurity\b/i);
});

// --- Issue 2: placeholder leakage from removePlaceholderKpiValues -------

function removePlaceholderKpiValues(content) {
  return content
    .replace(/\|\s*1\s*\|\s*Target\s*:\s*1\s*\|/gi, "| Not yet measured | Target: to be defined |")
    .replace(/\b1\s*\|\s*Target\s*:\s*1\b/gi, "Not yet measured | Target: to be defined")
    .replace(/\b1\s*(?:[-–—]\s*)?\/\s*(?:target\s*[:\-–—]?\s*)?1\b/gi, "Not yet measured")
    .replace(/\b1\s*\/\s*Target\s*:\s*1\b/gi, "Not yet measured")
    .replace(/\b1\s*\/\s*Target\s*1\b/gi, "Not yet measured")
    .replace(/\b1\s*\/\s*Target\b/gi, "Not yet measured")
    .replace(
      /\bValue\s*:\s*1\s*(?:\||,|;|\s+-\s+)\s*Target\s*:\s*1\b/gi,
      "Value: Not yet measured | Target: to be defined"
    )
    .replace(/\bMetric\s*:\s*1\b/gi, "Metric: Not yet measured")
    .replace(/\b(Current|Baseline|Threshold)\s*:\s*1\b/gi, "$1: Not yet measured")
    .replace(/\bTarget\s*:\s*1\b/gi, "Target: to be defined")
    .replace(/\bTarget\s+1\b/gi, "Target: to be defined")
    .replace(/\bValue\s*:\s*1\b/gi, "Value: Not yet measured")
    .trim();
}

test("removePlaceholderKpiValues no longer substitutes 'Validation Required' or 'validation test required' for a malformed AI KPI placeholder (the exact live bug)", () => {
  const malformed = "Metric: 1 | Value: 1 | Target: 1\nActivation: 1/Target 1\nRetention: 1 | Target: 1";
  const repaired = removePlaceholderKpiValues(malformed);

  assert.doesNotMatch(repaired, /Validation Required/i);
  assert.doesNotMatch(repaired, /validation test required/i);
  assert.match(repaired, /Not yet measured/);
  assert.match(repaired, /to be defined/);
});

test("plan-executor.ts's removePlaceholderKpiValues source no longer contains the literal banned replacement strings (drift check)", () => {
  const fnMatch = /function removePlaceholderKpiValues\(content: string\) \{([\s\S]*?)\n\}/.exec(
    planExecutorSource
  );
  assert.ok(fnMatch, "removePlaceholderKpiValues not found");
  // Checked against the .replace() code only (the surrounding comment
  // legitimately documents the old, now-removed behavior in prose).
  const codeOnly = fnMatch[1].replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(codeOnly, /"Validation Required"/);
  assert.doesNotMatch(codeOnly, /"[^"]*validation test required[^"]*"/);
});

test("enforcePlanReportLanguage localizes the new 'Not yet measured' / 'to be defined' phrasing for Turkish reports, both directions (drift check)", () => {
  assert.match(planExecutorSource, /\.replace\(\/\\bNot yet measured\\b\/gi, "Henüz ölçülmedi"\)/);
  assert.match(planExecutorSource, /\.replace\(\/\\bto be defined\\b\/gi, "Tanımlanacak"\)/);
  assert.match(
    planExecutorSource,
    /\.replace\(\/\\bHenüz ölçülmedi\\b\(\?!\[a-zA-ZçğıöşüÇĞİÖŞÜ\]\)\/gi, "Not yet measured"\)/
  );
  assert.match(
    planExecutorSource,
    /\.replace\(\/\\bTanımlanacak\\b\(\?!\[a-zA-ZçğıöşüÇĞİÖŞÜ\]\)\/gi, "to be defined"\)/
  );
});

test("the dead-but-present !context early-return branch in normalizeFullPlanReport also runs the placeholder cleanup (defense in depth, drift check)", () => {
  const branchMatch = /if \(!context\) \{([\s\S]*?)\n  \}/.exec(planExecutorSource);
  assert.ok(branchMatch, "!context branch not found");
  assert.match(branchMatch[1], /omitInternalSourceMetadataPlaceholders/);
  assert.match(branchMatch[1], /replaceBareValidationRequiredValue/);
  assert.match(branchMatch[1], /fixPerUnitWordBoundaryArtifacts/);
});

test("a Sources citation entry from a maritime report with 'Source type: Validation Required' has only that field omitted", () => {
  const sourceMetadataValidationPlaceholderPattern =
    /\b(?:Source type|Kaynak türü|Confidence|Güven)\s*[:\-–—]\s*(?:Validation Required|Doğrulama [Gg]erekli)\.?/gi;
  function omitInternalSourceMetadataPlaceholders(content) {
    return content
      .split("\n")
      .map((line) => {
        sourceMetadataValidationPlaceholderPattern.lastIndex = 0;
        if (!sourceMetadataValidationPlaceholderPattern.test(line)) return line;
        if (line.includes("|")) {
          return line
            .split("|")
            .map((s) => s.trim())
            .filter((s) => {
              sourceMetadataValidationPlaceholderPattern.lastIndex = 0;
              return s && !sourceMetadataValidationPlaceholderPattern.test(s);
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

  const line =
    "Title: Singapore Maritime Port Authority Fleet Compliance Report | Publisher: Maritime and Port Authority of Singapore | Year: 2024 | Source type: Validation Required";
  const out = omitInternalSourceMetadataPlaceholders(line);

  assert.doesNotMatch(out, /Validation Required/);
  assert.match(out, /Title: Singapore Maritime Port Authority Fleet Compliance Report/);
  assert.match(out, /Publisher: Maritime and Port Authority of Singapore/);
  assert.match(out, /Year: 2024/);
});
