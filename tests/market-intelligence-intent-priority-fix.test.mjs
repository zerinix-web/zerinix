import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL ROUTING FIX -- prioritize Market Intelligence intent over
// launch keywords.
//
// A prior fix (applyPromptIntentModeOverride, app/lib/report-engine/
// domain.ts) already corrected "plan" -> "market" for an unambiguous
// Market Intelligence prompt, but its countersignal check reused the
// broad, general-purpose ventureCreationSignals/
// explicitBusinessReportSignals -- which match on bare "startup"/
// "founder"/"launch a business" words anywhere in the prompt. Confirmed
// live: "I want to evaluate the European AI cybersecurity market before
// launching a new B2B security product." still misrouted to Business
// Plan, because "launching a new B2B security product" alone was
// enough to trip a broad venture-creation signal and block the
// override, even though the prompt's actual, dominant intent (evaluate
// the market) was completely unambiguous.
//
// Fix: the countersignal is now scoped to only the specific,
// unambiguous EXECUTION-planning phrases the ticket names (create
// business plan / build company strategy / operating plan / financial
// forecast / GTM execution roadmap / startup execution) -- a generic
// "launch"/"build"/"product idea"/"before entering" elsewhere in the
// prompt can no longer block a genuine Market Intelligence signal.
// marketIntelligenceIntentSignals itself was also widened to cover two
// previously-uncovered rule-1 phrases: "analyze industry" (a verb+
// industry pairing, not just verb+market) and "competitor analysis" (a
// noun phrase, distinct from the already-covered "analyze competitors"
// verb phrase).
//
// Only routing/classification logic was touched -- Acquisition routing,
// the centralized executive decision vocabulary, and report generation
// are all confirmed unmodified below.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importDomain() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/domain.ts");
  const source = readFileSync(sourcePath, "utf8");
  const dir = mkdtempSync(join(tmpdir(), "zerinix-domain-"));
  const outPath = join(dir, "domain.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { applyPromptIntentModeOverride, classifyReportDomain, resolveReportDomainForSelectedMode } =
  await importDomain();

// --- 1. The ticket's two required regression prompts, verbatim --------

test("Market Intelligence: \"I want to evaluate the European AI cybersecurity market before launching a new B2B security product.\" -> Market Intelligence", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt: "I want to evaluate the European AI cybersecurity market before launching a new B2B security product.",
  });
  assert.equal(result.selectedMode, "market");
  assert.equal(result.overridden, true);
});

test("Business Plan: \"I want to build a B2B AI cybersecurity startup.\" -> Business Plan", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt: "I want to build a B2B AI cybersecurity startup.",
  });
  assert.equal(result.selectedMode, "plan");
  assert.equal(result.overridden, false);
});

// --- 2. Rule 1: Market Intelligence trigger phrases, each in isolation -

test("each of the ticket's seven Market Intelligence trigger phrases is recognized on its own", () => {
  const prompts = [
    "I want to evaluate the fintech market.",
    "Please research the healthcare market.",
    "Help me understand the market for AI tools.",
    "We need to assess market attractiveness for this segment.",
    "Please analyze the fintech industry landscape.",
    "We need a competitor analysis for the payments space.",
    "Assess the market opportunity for this product.",
  ];

  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, true, `expected an override for: "${prompt}"`);
    assert.equal(result.selectedMode, "market");
  }
});

// --- 3. Rule 1: Market Intelligence has PRIORITY over generic --------
// --- launch/build/product-idea/before-entering language ---------------

test("Market Intelligence intent wins even when the prompt also contains 'launch', 'build', a 'product idea', or 'before entering'", () => {
  const prompts = [
    "I want to evaluate the AI cybersecurity market before launching a new B2B security product.",
    "I want to research the fintech market before we build our product idea further.",
    "As a startup founder, I want to understand the market before launching.",
    "Assess the market opportunity before entering this space with our new product idea.",
  ];

  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, true, `expected Market Intelligence to win priority for: "${prompt}"`);
    assert.equal(result.selectedMode, "market");
  }
});

// --- 4. Rule 2: Business Plan requires genuine EXECUTION intent --------

test("each of the ticket's six Business Plan execution-intent phrases blocks the override, even alongside a Market Intelligence signal", () => {
  const prompts = [
    "Evaluate the market, then create a business plan for our startup.",
    "Research the market, then help us build company strategy.",
    "Understand the market and put together an operating plan.",
    "Assess market opportunity, then prepare a financial forecast.",
    "Analyze the industry, then define a go-to-market execution roadmap.",
    "Evaluate the market, we need startup execution next.",
  ];

  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, false, `expected no override for: "${prompt}"`);
    assert.equal(result.selectedMode, "plan");
  }
});

test("a bare 'launch'/'build'/'startup' mention, without genuine execution-planning language, no longer blocks the override (the exact reported regression)", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt: "As a startup founder, I want to understand the market before launching my product idea.",
  });
  assert.equal(result.overridden, true);
  assert.equal(result.selectedMode, "market");
});

// --- 5. Rule 3: does not break Acquisition routing, Decision --------
// --- vocabulary, or report generation -----------------------------------

test("an Acquisition Due Diligence prompt under 'plan' is never overridden to 'market'", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt:
      "We are evaluating an acquisition of a cybersecurity SaaS company. Purchase price is $40M, ARR is $10M. Assess the market position before we proceed with due diligence.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "plan");
});

test("classifyReportDomain's acquisition/business classification is unaffected by this fix (drift check)", () => {
  assert.equal(classifyReportDomain("I want to acquire a cybersecurity SaaS company."), "acquisition");
  assert.equal(
    classifyReportDomain(
      "I want to launch a B2B AI cybersecurity platform for small and medium-sized businesses in Europe."
    ),
    "business"
  );
});

test("resolveReportDomainForSelectedMode's own plan/acquisition/market behavior is unchanged (drift check)", () => {
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "plan", inferredDomain: "acquisition" }),
    "acquisition"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "market", inferredDomain: "business" }),
    "business"
  );
});

test("a genuinely mixed prompt (clear Market Intelligence intent AND explicit Business Plan execution intent) is left unchanged, not guessed at", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt:
      "Evaluate the AI cybersecurity market opportunity, then help me build the company and create a business plan with a pricing and go-to-market plan.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "plan");
});

test("'market' and 'chat' selections are never touched by this override (drift check)", () => {
  assert.deepEqual(
    applyPromptIntentModeOverride({ selectedMode: "market", prompt: "Evaluate the AI cybersecurity market." }),
    { selectedMode: "market", overridden: false }
  );
  assert.deepEqual(
    applyPromptIntentModeOverride({ selectedMode: "chat", prompt: "Evaluate the AI cybersecurity market." }),
    { selectedMode: "chat", overridden: false }
  );
});

test("the centralized executive decision vocabulary and PDF/report generation are untouched by this fix (drift check)", () => {
  const vocabularySource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    vocabularySource,
    /"PROCEED"\s*\|\s*"PROCEED_WITH_CONDITIONS"\s*\|\s*"PAUSE_PENDING_REVIEW"\s*\|\s*"REJECT"/
  );

  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(pdfSource, /marketIntelligenceIntentSignals|businessPlanExecutionIntentSignals/);

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(marketPromptSource, /marketIntelligenceIntentSignals/);

  const planPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/plan.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(planPromptSource, /marketIntelligenceIntentSignals/);
});
