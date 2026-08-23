import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// CRITICAL BUG FIX -- Market Intelligence prompts were being routed to
// Business Plan.
//
// Confirmed live: "I want to evaluate the European AI cybersecurity
// market before launching a new B2B security product. The goal is to
// understand whether this market is attractive before building the
// product. Create a Market Intelligence Report." unambiguously asks to
// evaluate a market's attractiveness, not to build/price/launch a
// company, yet under the "plan" (Business Idea Validation) card it
// generated a Business Plan Report.
//
// Root cause: Market Intelligence ("market") and Business Idea
// Validation ("plan") are two separate, explicitly user-selected cards.
// Investigated exhaustively across app/lib/report-engine/domain.ts,
// app/lib/ai/expertise-profile.ts, app/lib/ai/understanding.ts,
// app/api/plan/route.ts, app/api/understanding/route.ts, and
// components/Planner.tsx: every one of them simply trusts whatever
// selectedMode/analysisMode it is handed -- none of them classified raw
// prompt text into market-vs-plan intent. The only precedent for
// correcting an unambiguous mode mismatch before generation is
// app/lib/ai/document-intelligence.ts's applyDocumentAwareModeOverride
// (attachment-category-based, forces "chat" for a confident
// legal_document). This fix adds the direct text-intent analog,
// applyPromptIntentModeOverride (app/lib/report-engine/domain.ts), and
// wires it into app/api/plan/route.ts immediately alongside the
// existing document-aware override, before anything downstream reads
// body.analysisMode.
//
// Only routing/classification logic was touched -- report generation,
// financial calculations, PDF layout, and every other classifier are
// unmodified.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function importDomain() {
  const sourcePath = join(repoRoot, "app/lib/report-engine/domain.ts");
  let source = readFileSync(sourcePath, "utf8");
  source = source.replace(
    '"@/app/lib/ai/expertise-profile"',
    JSON.stringify(pathToFileURL(join(repoRoot, "app/lib/ai/expertise-profile.ts")).href)
  );
  const dir = mkdtempSync(join(tmpdir(), "zerinix-domain-"));
  const outPath = join(dir, "domain.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { applyPromptIntentModeOverride, classifyReportDomain, resolveReportDomainForSelectedMode } =
  await importDomain();

const planRouteSource = readFileSync(new URL("../app/api/plan/route.ts", import.meta.url), "utf8");

const TICKET_PROMPT =
  "I want to evaluate the European AI cybersecurity market before launching a new B2B security product.\n\n" +
  "The goal is to understand whether this market is attractive before building the product.\n\n" +
  "Create a Market Intelligence Report.";

// --- 1. The exact reported bug is fixed -------------------------------

test("the exact reported bug: the ticket's test prompt, submitted under the 'plan' card, is corrected to 'market'", () => {
  const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt: TICKET_PROMPT });
  assert.equal(result.selectedMode, "market");
  assert.equal(result.overridden, true);
});

// --- 2. Rule 1: Market Intelligence trigger phrases --------------------

test("each of the ticket's listed Market Intelligence intent phrases triggers the override on its own", () => {
  const prompts = [
    "I want to evaluate the fintech market before deciding whether to proceed.",
    "Please research the market for AI-powered logistics software in Southeast Asia.",
    "Help me understand the industry landscape for enterprise cybersecurity vendors.",
    "Analyze our competitors in the European cloud storage space.",
    "We need to assess market opportunity for a new B2B payments product.",
    "What should we know before entering a market like healthcare AI?",
  ];

  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, true, `expected an override for: "${prompt}"`);
    assert.equal(result.selectedMode, "market");
  }
});

// --- 3. Rule 2: Business Plan trigger phrases are never overridden -----

test("each of the ticket's listed Business Plan intent phrases is left on 'plan', even when 'market' appears incidentally", () => {
  const prompts = [
    "I want to build a company that sells AI cybersecurity tools to the European market.",
    "Help me create a business plan for a B2B SaaS startup targeting the fintech market.",
    "I'm ready to launch a startup in the healthcare AI market.",
    "Define the execution roadmap for our go-to-market launch.",
    "I need a pricing and go-to-market execution plan for our new product.",
  ];

  for (const prompt of prompts) {
    const result = applyPromptIntentModeOverride({ selectedMode: "plan", prompt });
    assert.equal(result.overridden, false, `expected no override for: "${prompt}"`);
    assert.equal(result.selectedMode, "plan");
  }
});

// --- 4. Conservative behavior: mixed signals, incidental mentions -------

test("a prompt that genuinely mixes Market Intelligence and Business Plan intent is left unchanged, not guessed at", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt:
      "Evaluate the AI cybersecurity market opportunity, then help me build the company and create a business plan with a pricing and go-to-market plan.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "plan");
});

test("a prompt that merely mentions 'market' in passing, without an evaluation intent, is never overridden (no over-triggering)", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt:
      "I want to build a healthcare SaaS platform targeting the hospital market. Help me define pricing and customer acquisition strategy.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "plan");
});

test("explicitly naming the desired report is honored on its own, in both directions", () => {
  const marketNamed = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt: "Please prepare this as a Market Intelligence Report.",
  });
  assert.equal(marketNamed.overridden, true);
  assert.equal(marketNamed.selectedMode, "market");

  const businessNamed = applyPromptIntentModeOverride({
    selectedMode: "plan",
    prompt: "Evaluate the market and prepare this as a Business Plan Report.",
  });
  assert.equal(businessNamed.overridden, false);
  assert.equal(businessNamed.selectedMode, "plan");
});

// --- 5. Rule 3: does not break Acquisition routing, Business Plan ------
// --- routing, or Decision vocabulary -----------------------------------

test("an Acquisition Due Diligence prompt under 'plan' is never overridden to 'market', even when it also assesses the target's market position", () => {
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
    resolveReportDomainForSelectedMode({ selectedMode: "plan", inferredDomain: "business" }),
    "business"
  );
  assert.equal(
    resolveReportDomainForSelectedMode({ selectedMode: "market", inferredDomain: "business" }),
    "business"
  );
});

test("an already-correct 'market' selection is left completely alone (never touched by this override)", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "market",
    prompt: "Evaluate the AI cybersecurity market.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "market");
});

test("'chat' (Strategic Advisory) selections are left completely alone (this fix only ever corrects 'plan' -> 'market')", () => {
  const result = applyPromptIntentModeOverride({
    selectedMode: "chat",
    prompt: "Evaluate the AI cybersecurity market before entering it.",
  });
  assert.equal(result.overridden, false);
  assert.equal(result.selectedMode, "chat");
});

// --- 6. Integration: wired into app/api/plan/route.ts before any -------
// --- downstream read of body.analysisMode ------------------------------

test("app/api/plan/route.ts applies the prompt-intent override immediately alongside the existing document-aware override, before any downstream read of body.analysisMode", () => {
  const documentOverrideIndex = planRouteSource.indexOf("applyDocumentAwareModeOverride({");
  const promptOverrideIndex = planRouteSource.indexOf("applyPromptIntentModeOverride({");
  assert.ok(documentOverrideIndex > -1, "applyDocumentAwareModeOverride call site not found");
  assert.ok(promptOverrideIndex > -1, "applyPromptIntentModeOverride call site not found");
  assert.ok(
    promptOverrideIndex > documentOverrideIndex,
    "prompt-intent override must run after the document-aware override"
  );

  const laterDownstreamRead = planRouteSource.indexOf(
    "normalizeSelectedAnalysisMode(body.analysisMode)",
    promptOverrideIndex
  );
  assert.ok(
    laterDownstreamRead > promptOverrideIndex,
    "at least one downstream read of body.analysisMode must occur after the override"
  );
});

test("domain.ts's local, duplicated mode-value list stays in sync with expertise-profile.ts's real definition (drift check)", () => {
  const domainSource = readFileSync(
    new URL("../app/lib/report-engine/domain.ts", import.meta.url),
    "utf8"
  );
  const expertiseProfileSource = readFileSync(
    new URL("../app/lib/ai/expertise-profile.ts", import.meta.url),
    "utf8"
  );
  assert.match(domainSource, /const localSelectedAnalysisModeValues = \["plan", "market", "chat"\] as const;/);
  assert.match(expertiseProfileSource, /export const selectedAnalysisModeValues = \["plan", "market", "chat"\] as const;/);
});

// --- 7. Decision vocabulary is untouched by this fix (drift check) -----

test("the centralized executive decision vocabulary is untouched by this routing-only fix (drift check)", () => {
  const vocabularySource = readFileSync(
    new URL("../app/lib/report-engine/executive-decision-vocabulary.ts", import.meta.url),
    "utf8"
  );
  assert.match(
    vocabularySource,
    /"PROCEED"\s*\|\s*"PROCEED_WITH_CONDITIONS"\s*\|\s*"PAUSE_PENDING_REVIEW"\s*\|\s*"REJECT"/
  );
  assert.doesNotMatch(vocabularySource, /applyPromptIntentModeOverride/);
});

test("ReportPdfButton.tsx (PDF layout) and report generation prompts are untouched by this fix (drift check)", () => {
  const pdfSource = readFileSync(
    new URL("../app/dashboard/[id]/ReportPdfButton.tsx", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(pdfSource, /applyPromptIntentModeOverride/);

  const marketPromptSource = readFileSync(
    new URL("../app/lib/report-engine/prompts/market.ts", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(marketPromptSource, /applyPromptIntentModeOverride/);
});
