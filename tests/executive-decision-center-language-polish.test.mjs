import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

// FINAL EXECUTIVE DASHBOARD LANGUAGE POLISH -- the Executive Decision
// Center's logic (decision extraction, confidence heuristics, risk/action
// keyword matching) is already correct as of the prior turn; this pass is
// wording-only, replacing four specific remaining internal-style strings
// with board-memo-appropriate language, plus one more narrowing of the
// executive-call vocabulary ("Pause with Reasons" -> "Pause Pending
// Review"). No calculation, report-generation, user-fact, routing, or
// sanitization code was touched.

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

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

  const dir = mkdtempSync(join(tmpdir(), "zerinix-executive-decision-language-"));
  const outPath = join(dir, "report-presentation.ts");
  writeFileSync(outPath, source);
  return import(pathToFileURL(outPath).href);
}

const { buildExecutiveSnapshot } = await importReportPresentation();

const presentationSource = readFileSync(
  new URL("../app/lib/report-presentation.ts", import.meta.url),
  "utf8"
);
const plannerSource = readFileSync(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const decisionEngineSource = readFileSync(
  new URL("../app/lib/decision-intelligence/decision-engine.ts", import.meta.url),
  "utf8"
);
const planExecutorSource = readFileSync(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const acquisitionAnalysisSource = readFileSync(
  new URL("../app/lib/report-engine/prompts/acquisition-analysis.ts", import.meta.url),
  "utf8"
);

// --- 1. Confidence fallback wording -----------------------------------------

test("the moderate-confidence fallback uses the exact required board-level phrasing, not the old internal-sounding 'Limited -- some figures...' string", () => {
  assert.doesNotMatch(
    presentationSource,
    /Limited -- some figures are available, key inputs are still missing/
  );
  assert.match(
    presentationSource,
    /Moderate confidence based on available transaction inputs; additional financial and retention data required\./
  );
});

test("the moderate-confidence fallback is reachable end to end through buildExecutiveSnapshot for a report with some (but not many) concrete figures", () => {
  // Exactly one dollar figure and one gap phrase -> "moderate" completeness.
  const content = "Purchase price is $40M. The target's EBITDA has not yet been verified.";
  const snapshot = buildExecutiveSnapshot(content, undefined, undefined);
  assert.equal(
    snapshot.confidence,
    "Moderate confidence based on available transaction inputs; additional financial and retention data required."
  );
});

// --- 2. "Warnings / Missing Evidence" heading -------------------------------

test("the advisories heading is 'Key Information Needed Before Final Approval', not the old internal-sounding 'Warnings / Missing Evidence'", () => {
  assert.doesNotMatch(plannerSource, /Warnings \/ Missing Evidence/);
  assert.match(plannerSource, /Key Information Needed Before Final Approval/);
  // Both the heading itself and the disclosure sentence that names it in
  // quotes must be updated together, or the disclosure sentence would
  // point users to a section title that no longer exists.
  assert.match(
    plannerSource,
    /included in the report.s .Key Information Needed Before Final Approval. section/
  );
});

// --- 3. "authoritative evidence" -> "additional due diligence review" ------

test("'authoritative evidence' no longer appears anywhere in decision-engine.ts", () => {
  assert.doesNotMatch(decisionEngineSource, /authoritative evidence/i);
});

test("the real-estate AVOID/BUY-gate reasoning now uses 'additional due diligence review' language instead of 'authoritative evidence'", () => {
  assert.match(decisionEngineSource, /additional due diligence review identifies an adverse condition/);
  assert.match(decisionEngineSource, /additional due diligence review confirmed an adverse condition/);
});

// --- 4. Final recommendation: Proceed with Conditions / Pause Pending Review / Reject -

test("describeAcquisitionExecutiveCall maps Wait to 'Pause Pending Review' (not the old 'Pause with Reasons'), and Proceed/Proceed Carefully/Avoid are unchanged", () => {
  const fnMatch = /function describeAcquisitionExecutiveCall\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(fnMatch, "describeAcquisitionExecutiveCall not found");
  const body = fnMatch[0];
  assert.doesNotMatch(body, /Pause with Reasons/);
  assert.match(body, /return "Pause Pending Review";/);
  assert.match(body, /if \(recommendation === "Proceed"\) return "Proceed with Conditions";/);
  assert.match(body, /if \(recommendation === "Avoid"\) return "Reject";/);
});

test("finalInvestmentRecommendation requires exactly Proceed with Conditions / Pause Pending Review / Reject, each paired with one clear sentence of reasoning, and forbids outputting only the bare call words", () => {
  const prompt = acquisitionAnalysisSource;
  assert.match(prompt, /Proceed with Conditions, Pause Pending Review, or Reject/);
  assert.match(prompt, /one clear sentence explaining why/i);
  assert.match(prompt, /Never output only the words 'Pause Pending Review', 'Reject', or 'Proceed with Conditions'/);
  assert.doesNotMatch(prompt, /Pause with Reasons/);
});

test("report-presentation.ts's decision-card extraction recognizes 'Pause Pending Review' verbatim and never collapses it into the generic WAIT default", () => {
  const content =
    "Executive recommendation: Pause Pending Review -- the target's financial statements are not yet verified.";
  const snapshot = buildExecutiveSnapshot(content, undefined, undefined);
  assert.equal(snapshot.decision, "PAUSE PENDING REVIEW");
  assert.notEqual(snapshot.decision, "WAIT");
});

test("a board-level recommendation is never just the bare call -- structurally, the call is always followed by '-- ${reasoning}' in the same sentence", () => {
  const prelimMatch = /function buildFallbackPreliminaryRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  const finalMatch = /function buildFallbackFinalRecommendation\([\s\S]*?\n}/.exec(planExecutorSource);
  assert.ok(prelimMatch && finalMatch);
  assert.match(prelimMatch[0], /\$\{call\} -- \$\{reasoning\}/);
  assert.match(finalMatch[0], /\$\{call\} -- \$\{reasoning\}/);
});

// --- 5. Do not change calculations, report generation, user facts, routing, sanitization -

test("acquisition-deal-facts.ts's calculations, report-presentation-sanitizer.ts, and domain routing are all untouched by this wording-only fix (drift check)", async () => {
  const { extractAcquisitionDealFacts, computeAcquisitionDerivedMetrics } = await import(
    "../app/lib/ai/acquisition-deal-facts.ts"
  );
  const { stripReportPresentationArtifacts } = await import(
    "../app/lib/report-engine/report-presentation-sanitizer.ts"
  );
  const { classifyReportDomain } = await import("../app/lib/report-engine/domain.ts");

  const facts = extractAcquisitionDealFacts(
    "Purchase price: $40M\nARR: $10M\nEnterprise customers: 500\nEmployees: 80\nBuyer available capital: $25M\nDebt financing: $15M"
  );
  const derived = computeAcquisitionDerivedMetrics(facts);
  assert.equal(derived.evToArr, 4.0);
  assert.equal(derived.equityContribution, 25_000_000);
  assert.equal(derived.debtRequirement, 15_000_000);
  assert.equal(typeof stripReportPresentationArtifacts, "function");
  assert.equal(
    classifyReportDomain("We are acquiring a cybersecurity SaaS company for $40M."),
    "acquisition"
  );
});
