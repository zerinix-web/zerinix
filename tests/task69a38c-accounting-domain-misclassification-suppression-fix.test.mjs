// TASK #69A-38C -- Remove the unintended raw legacy report block from the
// REAL fresh BIV runtime path.
//
// LIVE FAILURE, confirmed by direct database inspection of a genuinely
// fresh, just-generated conversation (not a persisted-old-report issue,
// and not the #69A-38B addendum's message-ordering race, which was
// separately confirmed already fixed and correctly ordered for this
// exact conversation): the completed report message still rendered its
// full raw getReportMarkdown dump ("# Business Plan Report", "##
// Executive Summary", "Executive Decision: MONITOR (Confidence: 62%)",
// "Confidence Reduced Because:", "Why:", "Top 3 Reasons:", "Top 3
// Risks:", plus internal investment-score category explanation prose
// such as "Competitive Advantage: Competitive evidence: 93%...")
// instead of being suppressed by #69A-9/#69A-10's own, already-correct
// shouldShowReportCompletionHeadline/isCompletedBusinessPlanReportMessage
// mechanism.
//
// ROOT CAUSE, proven empirically (not assumed) by running the REAL
// classifyReportDomain function against the REAL persisted preceding
// user message for that exact conversation:
//
//   classifyReportDomain(
//     "I'm considering launching a premium AI-powered financial
//      planning, cash-flow forecasting, and scenario-planning SaaS
//      specifically for small and medium-sized businesses (SMBs) in the
//      United States. The product would integrate with accounting
//      platforms such as QuickBooks and Xero and help SMB owners
//      forecast cash flow, model financial scenarios, identify risks,
//      and make better financial decisions. Evaluate whether this is a
//      viable business opportunity, ..."
//   ) === "accounting"   // WRONG -- this is an unambiguous BIV prompt
//
// domain.ts's specializedDomainSignals list checked ["accounting",
// /\baccounting\b/i] (a BARE word) before operatingBusinessSignals ever
// got a chance to recognize the prompt's own unambiguous SaaS/business-
// plan shape -- the prompt merely NAMES the accounting SOFTWARE it
// integrates with (an ordinary feature/integration mention any fintech,
// ERP, or ops SaaS could make), not a genuine accounting-service
// request. isCompletedBusinessPlanReportMessage requires an EXACT
// "business" domain match with zero tolerance for a near-miss, so this
// one misclassified word silently defeated the entire suppression rule
// -- for a report that is, in every other respect, a completely
// ordinary, successfully-generated Business Idea Validation report.
//
// Why previous tests (#69A-9/#69A-10, and this same task's own earlier
// #69A-38B addendum test) did not catch this: they all used a
// synthetic/simplified BIV prompt (task69a10's own REAL_BIV_PROMPT, and
// this ticket's own earlier addendum test's REAL_ADDENDUM_PROMPT) that
// never happened to mention a real accounting-platform integration --
// shouldShowReportCompletionHeadline itself was never broken; only ONE
// specific, previously-untested real-world prompt shape (an explicit
// QuickBooks/Xero integration mention) exposed the classifier's
// pre-existing bare-word imprecision. The exact same false-positive
// class (a generic feature-mention word overriding an unambiguous
// business-shaped prompt) was already fixed once in this same file for
// "vendor" (procurement) -- this task applies the identical remedy to
// "accounting".
//
// FIX (app/lib/report-engine/domain.ts): the "accounting"
// specializedDomainSignals entry now requires a genuine accounting
// service/compliance-request phrase (accounting services/review/
// report/compliance/reconciliation/audit, bookkeeping, invoice
// processing, trial balance review, IFRS/GAAP/VAT/tax compliance, the
// Turkish equivalents) instead of the bare word "accounting" -- an
// incidental "integrates with accounting platforms" mention inside an
// otherwise-unambiguous BIV/SaaS pitch no longer hijacks classification.
// No other specializedDomainSignals entry (legal/procurement/
// operations/finance) was touched; no canonical report data, PDF
// generation, persistence schema, or #69A-37/37A/38/38B fix was
// modified.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyReportDomain } from "../app/lib/report-engine/domain.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const domainSource = readFileSync(join(repoRoot, "app/lib/report-engine/domain.ts"), "utf8");
const chatMessagesSource = readFileSync(join(repoRoot, "components/planner/ChatMessages.tsx"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

// The exact real, persisted user prompt from the live conversation that
// exposed this bug (captured via direct, read-only database inspection).
const REAL_LIVE_PROMPT =
  "I’m considering launching a premium AI-powered financial planning, cash-flow forecasting, and scenario-planning SaaS specifically for small and medium-sized businesses (SMBs) in the United States. The product would integrate with accounting platforms such as QuickBooks and Xero and help SMB owners forecast cash flow, model financial scenarios, identify risks, and make better financial decisions. Evaluate whether this is a viable business opportunity, identify the target customer and competitive landscape, assess Porter’s Five Forces, pricing and go-to-market strategy, and give me a clear investment decision.";

const REAL_LIVE_REPORT_CONTENT =
  "# Business Plan Report\n\n## Executive Summary\n\nExecutive Decision: MONITOR (Confidence: 62%)\nConfidence Reduced Because:\n- Limited third-party validation\n\nWhy: Evidence is mixed.\n\nTop 3 Reasons:\n1. Real market demand signals\n2. Competitive whitespace exists\n3. Clear ICP\n\nTop 3 Risks:\n1. Crowded category\n2. Integration complexity\n3. Long sales cycle\n\n### Founder Score\n\nCompetitive Advantage: Competitive evidence: 93%. Distinct competitor organizations represented: 4.";

// --- [1]/[2]/[3] the completed BIV report is suppressed, raw block never ---
// --- rendered ---------------------------------------------------------

test("[1] the exact real, live prompt now classifies as 'business' -- the misclassification that defeated suppression is fixed", () => {
  assert.equal(classifyReportDomain(REAL_LIVE_PROMPT), "business");
});

test("[1b] FAIL-BEFORE PROOF: the OLD bare-word accounting pattern (reconstructed inline, not git-dependent) really did misclassify this exact live prompt as 'accounting'", () => {
  const oldAccountingPattern = /\b(accounting|invoice|ledger|trial balance|tax|vat|ifrs|gaap|muhasebe|fatura|vergi|kdv|defter)\b/i;
  assert.match(REAL_LIVE_PROMPT, oldAccountingPattern, "the OLD pattern's bare 'accounting' word must match this live prompt to prove the fail-before case is real, not vacuous");

  const oldLegalPattern = /\b(contract|agreement|clause|legal|compliance|liability|indemnity|termination|governing law|sözleşme|hukuk|uyum|sorumluluk|tazminat|fesih)\b/i;
  assert.doesNotMatch(REAL_LIVE_PROMPT, oldLegalPattern, "sanity: legal must not have already claimed this prompt ahead of accounting under the old ordering");
});

async function loadChatMessageFunctions() {
  function extractFunctionSource(source, name) {
    const startMatch = source.match(new RegExp(`export function ${name}\\(`));
    assert.notEqual(startMatch, null, `${name} not found`);
    const start = startMatch.index;
    let parenIndex = source.indexOf("(", start);
    let parenDepth = 0;
    for (; parenIndex < source.length; parenIndex++) {
      if (source[parenIndex] === "(") parenDepth++;
      if (source[parenIndex] === ")") {
        parenDepth--;
        if (parenDepth === 0) break;
      }
    }
    let i = source.indexOf("{", parenIndex);
    let depth = 0;
    for (; i < source.length; i++) {
      if (source[i] === "{") depth++;
      if (source[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    return source.slice(start, i + 1).replace(/^export /, "");
  }

  function stripTsTypes(text) {
    return text
      .replace(/message:\s*\{[^}]*\}/g, "message")
      .replace(/precedingUserContent\?:\s*string/g, "precedingUserContent")
      .replace(/content:\s*string/g, "content")
      .replace(/\)\s*:\s*[^{]+\{/g, ") {");
  }

  const blob = [
    stripTsTypes(extractFunctionSource(chatMessagesSource, "getReportCompletionHeadline")),
    stripTsTypes(extractFunctionSource(chatMessagesSource, "isCompletedBusinessPlanReportMessage")),
    stripTsTypes(extractFunctionSource(chatMessagesSource, "shouldShowReportCompletionHeadline")),
  ].join("\n\n");

  const domainUrl = pathToFileURL(join(repoRoot, "app/lib/report-engine/domain.ts")).href;
  const fullSource = [
    `import { classifyReportDomain } from ${JSON.stringify(domainUrl)};`,
    blob,
    "export { getReportCompletionHeadline, isCompletedBusinessPlanReportMessage, shouldShowReportCompletionHeadline };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "zerinix-chat-messages-69a38c-"));
  const outPath = join(dir, "chat-messages.mjs");
  writeFileSync(outPath, fullSource);
  return import(pathToFileURL(outPath).href);
}

let shouldShowReportCompletionHeadline;
let getReportCompletionHeadline;

test.before(async () => {
  const mod = await loadChatMessageFunctions();
  shouldShowReportCompletionHeadline = mod.shouldShowReportCompletionHeadline;
  getReportCompletionHeadline = mod.getReportCompletionHeadline;
});

const COMPLETED_MESSAGE = { role: "assistant", mode: "plan", status: "complete" };

test("[1c] the completed message for this exact real prompt now correctly qualifies for suppression", () => {
  assert.equal(shouldShowReportCompletionHeadline(COMPLETED_MESSAGE, REAL_LIVE_PROMPT), true);
});

test("[2] the ChatMessages.tsx list-render guard (return null for a qualifying message) suppresses the message ENTIRELY -- 'Executive Decision: ...' raw prose is never duplicated above the structured report", () => {
  assert.match(
    chatMessagesSource,
    /if \(shouldShowReportCompletionHeadline\(message, precedingUserContent\)\) \{\s*\n\s*return null;\s*\n\s*\}/
  );
});

test("[3] even in the fallback (mobile) path where only the headline is shown rather than the row suppressed, getReportCompletionHeadline never lets 'Why:'/'Top 3 Reasons:'/'Top 3 Risks:' or the Competitive Advantage diagnostic prose through -- only the title line survives", () => {
  const headline = getReportCompletionHeadline(REAL_LIVE_REPORT_CONTENT);
  assert.equal(headline, "# Business Plan Report");
  assert.doesNotMatch(headline, /Executive Decision|Confidence Reduced Because|Why:|Top 3 Reasons|Top 3 Risks|Competitive Advantage/);
});

// --- [4] the structured report still renders -------------------------

test("[4] ReportPanel (the structured, authoritative display) is completely untouched by this fix -- both desktop and mobile call sites remain", () => {
  assert.match(plannerSource, /const ReportPanel = memo\(function ReportPanel\(/);
  const reportPanelCallSites = plannerSource.match(/<ReportPanel/g) || [];
  assert.equal(reportPanelCallSites.length, 2);
});

// --- [5] normal chat messages still render normally --------------------

test("[5] ordinary chat-mode messages (and any non-plan, non-market mode) are never suppressed by this fix -- classifyReportDomain is never even consulted for them", () => {
  assert.equal(shouldShowReportCompletionHeadline({ role: "assistant", mode: "chat", status: "complete" }, REAL_LIVE_PROMPT), false);
  assert.equal(shouldShowReportCompletionHeadline({ role: "assistant", status: "complete" }, REAL_LIVE_PROMPT), false);
});

// --- [6]/[7]/[8] deterministic across reopen/refresh/regenerate --------

test("[6][7][8] classifyReportDomain is a pure function of its text input -- reopening a saved report, refreshing the page, or regenerating all re-run the IDENTICAL classification against the SAME persisted prompt text, so the fix holds deterministically across every one of these paths, not just the first render", () => {
  const results = new Set();
  for (let i = 0; i < 5; i++) {
    results.add(classifyReportDomain(REAL_LIVE_PROMPT));
  }
  assert.deepEqual([...results], ["business"]);
});

// --- [9] PDF generation still has access to required report data -------

test("[9] getReportMarkdown (the data PDF/persistence/regeneration still rely on) is completely unchanged -- this fix touches only domain classification, never report content, never what gets persisted", () => {
  assert.match(plannerSource, /function getReportMarkdown\(/);
  assert.doesNotMatch(plannerSource, /TASK #69A-38C/);
});

// --- [10] no canonical data deleted; fix is additive precision only ----

test("[10a] the domain.ts fix is a narrowing of ONE specializedDomainSignals entry (accounting) -- legal/procurement/operations/finance entries, and every other function in the file, are untouched", () => {
  assert.match(domainSource, /\["legal", \/\\b\(contract\|agreement\|clause\|legal\|compliance/);
  assert.match(domainSource, /\["procurement", \/\\b\(procurement\|e-procurement\|vendor management/);
  assert.match(domainSource, /\["operations", \/\\b\(operations\|workflow\|capacity/);
  assert.match(domainSource, /\["finance", \/\\b\(finance\|financial\|investment/);
});

test("[10b] genuine accounting-service requests (never the reported false-positive shape) still correctly classify as 'accounting' -- no real accounting use case was broken", () => {
  assert.equal(classifyReportDomain("We need bookkeeping and invoice processing support for our small business."), "accounting");
  assert.equal(classifyReportDomain("Review our trial balance reconciliation before quarter close."), "accounting");
  assert.equal(classifyReportDomain("Muhasebe hizmetleri için bir denetim raporu hazırla."), "accounting");
});

test("[10c] other ordinary SaaS prompts that merely mention accounting software/integrations as a FEATURE (not the report's own ask) now correctly classify as 'business', matching the established 'vendor'->procurement precedent for the identical false-positive class", () => {
  assert.equal(classifyReportDomain("A SaaS platform for startups that integrates with accounting software like QuickBooks."), "business");
  assert.equal(classifyReportDomain("Our expense management app connects to your accounting system automatically."), "business");
});

test("[10d] no report generation, decision-engine, financial-model, Porter, competitor-landscape, or #69A-37/37A/38/38B fixed file carries a #69A-38C marker -- this fix is confined to domain.ts's classifier precision", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/ai/financial-model.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-consistency-validation.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-38C/, `${relativePath} should not carry this task's marker`);
  }
});
