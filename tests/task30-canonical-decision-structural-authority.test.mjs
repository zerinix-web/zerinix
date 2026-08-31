import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildMarketIntelligenceGraph,
} from "../app/lib/ai/market-intelligence-graph.ts";
import {
  buildMarketIntelligenceCanonicalState,
  readMarketIntelligenceCanonicalState,
  resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
} from "../app/lib/report-engine/market-intelligence-canonical-state.ts";
import { detectPdfPresentationLocale } from "../app/lib/pdf-normalization.mjs";

// TASK #30 -- Make the Market Intelligence canonical decision pipeline
// structurally authoritative end-to-end.
//
// ROOT CAUSE (confirmed via full trace of dashboard home, workspace
// detail, the single-report page, and Planner.tsx):
//
// 1. app/dashboard/page.tsx's getDecisionSignal (the "reports ready for
//    review" card on the dashboard home list) ran every Market
//    Intelligence report through resolveCanonicalDecisionFromReportText,
//    a GENERIC, non-MI-aware resolver whose deterministic-banner tier
//    (extractExecutiveDecisionFromText) defaults to the "standard"
//    GO/CONDITIONAL_GO/NO_GO vocabulary, not "market" -- so it could
//    never recognize MI's own "Decision: ENTER/MONITOR/AVOID" banner.
//    ENTER and MONITOR reports fell all the way through to an unscoped
//    `\b(GO|WAIT|...)\b` keyword scan over the full executive summary --
//    the exact "Go-to-Market" false-positive class of bug already fixed
//    on every other Market Intelligence surface, just never closed here.
//    (AVOID coincidentally matched an EARLIER, unrelated real-estate
//    tier in that same function purely by token overlap -- never a real
//    Market Intelligence code path.)
// 2. app/dashboard/workspaces/[id]/page.tsx's detectWorkspaceSignal read
//    report.investmentScore?.recommendation with NO report-type guard at
//    all -- Market Intelligence has its own, separate, more conservative
//    market-entry decision engine and must never surface a generic
//    founder/business-viability GO/WAIT/PASS score.
// 3. getDecisionClasses (duplicated in app/dashboard/[id]/page.tsx and
//    components/Planner.tsx) colors the "Investment Decision Snapshot"
//    badge from GO/CONDITIONAL_GO/NO_GO-family words and the canonical
//    PROCEED/PROCEED_WITH_CONDITIONS/REJECT vocabulary only -- it had
//    zero recognition of ENTER/MONITOR/AVOID, so an ENTER, MONITOR, and
//    AVOID badge all rendered with the SAME neutral default color.
//
// FIX: (1) and (2) now resolve Market Intelligence through the SAME
// canonical-state-first resolver every other surface uses
// (resolveMarketIntelligenceExecutiveDecisionWithCanonicalState) BEFORE
// any generic/keyword fallback ever runs. (3) both files now compute a
// `decisionColorKey` that prefers `marketDecision?.canonicalDecision` --
// the same 4-value enum the resolver already computes -- so
// getDecisionClasses receives a value it already correctly colors, with
// zero new color-mapping logic.

const checkedAt = "2026-08-15T00:00:00.000Z";

function evidenceItem({ id, name, url, claim }) {
  return {
    id,
    field: "market_size",
    claim: claim || `${name} evidence relevant to this market analysis.`,
    value: "supporting evidence",
    label: "Verified from external source",
    sourceTitle: `${name} source`,
    publisher: name,
    url,
    sourceType: "market research",
    authorityLevel: "secondary",
    confidence: 78,
    qualityScore: 78,
    publishedDate: "2026-02-10",
    lastChecked: checkedAt,
    supportingData: ["figures"],
  };
}

function decisionBriefFixture(overrides = {}) {
  return {
    decision: "CONDITIONAL_GO",
    confidence: 58,
    confidenceDirection: "reduced",
    confidenceFactors: ["verified market size unavailable"],
    why: "Evidence supports conditional entry pending SOM validation.",
    topReasons: ["Active vendor landscape", "Growing category"],
    topRisks: ["Incumbent concentration", "Procurement cycle length"],
    missingEvidence: ["Independent win-rate data"],
    whatWouldChangeThisDecision: "A validated SOM above 5% would upgrade this to ENTER.",
    immediateNextAction: "Run a mid-market pilot before committing budget.",
    ...overrides,
  };
}

function realGraphFixture() {
  const evidence = [
    evidenceItem({ id: "R3", name: "DocuSign", url: "https://procurement.sc.gov/docusign-clm" }),
    evidenceItem({ id: "R4", name: "Ironclad", url: "https://ironclad.com/pricing" }),
    evidenceItem({ id: "R5", name: "Evisort", url: "https://evisort.com/ai-engine" }),
    evidenceItem({
      id: "R12",
      name: "Emergen Research",
      url: "https://emergenresearch.com/clm-market",
      claim: "Market research report values the U.S. CLM software market at $1.5 billion.",
    }),
  ];
  return buildMarketIntelligenceGraph({ evidence }, "AI compliance & contract intelligence SaaS");
}

function canonicalStateFor(decision, overrides = {}) {
  return buildMarketIntelligenceCanonicalState({
    graph: realGraphFixture(),
    decisionCriticalEvidence: {
      marketSizingResolved: decision === "GO",
      competitiveEvidenceResolved: decision !== "NO_GO",
      obtainableShareResolved: decision === "GO",
    },
    decisionBrief: decisionBriefFixture({ decision, ...overrides }),
  });
}

function readSourceFile(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

const dashboardHomeSource = readSourceFile("../app/dashboard/page.tsx");
const workspaceDetailSource = readSourceFile("../app/dashboard/workspaces/[id]/page.tsx");
const reportPageSource = readSourceFile("../app/dashboard/[id]/page.tsx");
const plannerSource = readSourceFile("../components/Planner.tsx");

// --- Structural audit: dashboard home no longer bypasses the canonical --
// --- resolver for Market Intelligence ------------------------------------

test("STRUCTURAL AUDIT: dashboard home's getDecisionSignal resolves Market Analysis through the canonical-state-aware resolver before any generic/keyword fallback", () => {
  const fnMatch = /function getDecisionSignal\([\s\S]*?\n}/.exec(dashboardHomeSource);
  assert.ok(fnMatch, "getDecisionSignal not found");
  const body = fnMatch[0];

  const marketBranchIndex = body.indexOf('report.type === "Market Analysis"');
  const canonicalCallIndex = body.indexOf("resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(");
  const genericResolverIndex = body.indexOf("resolveCanonicalDecisionFromReportText(");

  assert.ok(marketBranchIndex >= 0, "no Market Analysis type guard found");
  assert.ok(canonicalCallIndex >= 0, "no canonical-state-aware resolver call found");
  assert.ok(genericResolverIndex >= 0, "generic resolver call should still exist for non-MI report kinds");
  assert.ok(
    marketBranchIndex < canonicalCallIndex && canonicalCallIndex < genericResolverIndex,
    "the Market Analysis branch (and its canonical resolver call) must run, and return, before the generic resolver is ever reached"
  );

  // The generic resolver's own call site must no longer carry a
  // Market-Analysis-specific ternary -- that branch is now unreachable
  // for Market Analysis reports (they returned above), so any leftover
  // conditional there would be dead, misleading code.
  assert.doesNotMatch(
    body.slice(genericResolverIndex, genericResolverIndex + 200),
    /report\.type === "Market Analysis" \? undefined/
  );
});

test("STRUCTURAL AUDIT: dashboard home never falls through to the unscoped keyword regex for Market Analysis reports", () => {
  const fnMatch = /function getDecisionSignal\([\s\S]*?\n}/.exec(dashboardHomeSource);
  const body = fnMatch[0];
  const marketBranchMatch = /if \(report\.type === "Market Analysis"\) \{[\s\S]*?\n {2}\}/.exec(body);
  assert.ok(marketBranchMatch, "Market Analysis branch not found");
  // The branch must return unconditionally (early exit), never fall
  // through into the rest of the function's keyword-scanning logic.
  assert.match(marketBranchMatch[0], /return marketDecision\.decisionLabel/);
});

// --- Structural audit: workspace detail no longer leaks investmentScore -
// --- for Market Intelligence, unguarded --------------------------------

test("STRUCTURAL AUDIT: workspace detail's detectWorkspaceSignal guards Market Analysis BEFORE the unguarded investmentScore.recommendation read", () => {
  const fnMatch = /function detectWorkspaceSignal\([\s\S]*?\n\}/.exec(workspaceDetailSource);
  assert.ok(fnMatch, "detectWorkspaceSignal not found");
  const body = fnMatch[0];

  const marketBranchIndex = body.indexOf('report.type === "Market Analysis"');
  const canonicalCallIndex = body.indexOf("resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(");
  const investmentScoreLeakIndex = body.indexOf("report.investmentScore?.recommendation");

  assert.ok(marketBranchIndex >= 0, "no Market Analysis type guard found");
  assert.ok(canonicalCallIndex >= 0, "no canonical-state-aware resolver call found");
  assert.ok(investmentScoreLeakIndex >= 0, "investmentScore.recommendation fallback should still exist for non-MI report kinds");
  assert.ok(
    marketBranchIndex < canonicalCallIndex && canonicalCallIndex < investmentScoreLeakIndex,
    "Market Analysis must be resolved and returned BEFORE the generic investmentScore.recommendation leak"
  );
});

test("STRUCTURAL AUDIT: workspace detail never falls through to the unscoped keyword regex for Market Analysis reports", () => {
  const fnMatch = /function detectWorkspaceSignal\([\s\S]*?\n\}/.exec(workspaceDetailSource);
  const body = fnMatch[0];
  const marketBranchMatch = /if \(report\.type === "Market Analysis"\) \{[\s\S]*?\n {2}\}/.exec(body);
  assert.ok(marketBranchMatch, "Market Analysis branch not found");
  assert.match(marketBranchMatch[0], /return marketDecision\.decisionLabel/);
});

// --- Structural audit: getDecisionClasses is now fed a value it can -----
// --- actually color for every Market Intelligence verdict ---------------

test("STRUCTURAL AUDIT: app/dashboard/[id]/page.tsx's decisionColorKey prefers marketDecision.canonicalDecision, and every getDecisionClasses( call site uses it", () => {
  assert.match(reportPageSource, /const decisionColorKey = marketDecision\?\.canonicalDecision \|\| resolvedDecision\?\.decision \|\| recommendation;/);
  const callSites = reportPageSource.match(/getDecisionClasses\([^)]*\)/g) || [];
  const badgeCallSites = callSites.filter((call) => call !== "getDecisionClasses(decision: string)");
  assert.ok(badgeCallSites.length >= 2, "expected at least 2 getDecisionClasses badge call sites");
  for (const call of badgeCallSites) {
    assert.match(call, /getDecisionClasses\(decisionColorKey\)/, `stale raw-recommendation call site found: ${call}`);
  }
});

test("STRUCTURAL AUDIT: components/Planner.tsx's decisionColorKey prefers marketDecision.canonicalDecision, and every getDecisionClasses( call site uses it", () => {
  assert.match(plannerSource, /const decisionColorKey = marketDecision\?\.canonicalDecision \|\| resolvedDecision\?\.decision \|\| recommendation;/);
  const callSites = plannerSource.match(/getDecisionClasses\([^)]*\)/g) || [];
  const badgeCallSites = callSites.filter((call) => call !== "getDecisionClasses(decision: string)");
  assert.ok(badgeCallSites.length >= 2, "expected at least 2 getDecisionClasses badge call sites");
  for (const call of badgeCallSites) {
    assert.match(call, /getDecisionClasses\(decisionColorKey\)/, `stale raw-recommendation call site found: ${call}`);
  }
});

test("STRUCTURAL AUDIT: getDecisionClasses in both files recognizes every value marketDecision.canonicalDecision can actually produce (PROCEED, PROCEED_WITH_CONDITIONS, REJECT)", () => {
  for (const [name, source] of [
    ["app/dashboard/[id]/page.tsx", reportPageSource],
    ["components/Planner.tsx", plannerSource],
  ]) {
    const fnMatch = /function getDecisionClasses\([\s\S]*?\n\}/.exec(source);
    assert.ok(fnMatch, `getDecisionClasses not found in ${name}`);
    const body = fnMatch[0];
    assert.match(body, /"PROCEED"/, `${name}: PROCEED not recognized`);
    assert.match(body, /"REJECT"/, `${name}: REJECT not recognized`);
    assert.match(body, /"PROCEED_WITH_CONDITIONS"/, `${name}: PROCEED_WITH_CONDITIONS not recognized`);
  }
});

// --- Behavioral: requirement #6 regression scenarios ---------------------

test("REGRESSION: canonical MONITOR (CONDITIONAL_GO) cannot render ENTER anywhere, across every simulated surface (dashboard home, workspace, report page, PDF), regardless of conflicting prose", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", { confidence: 55 });
  const conflictingProseVariants = [
    "Bottom Line -- Decision: ENTER the market immediately (Confidence: 95%).",
    "Decision: ENTER (Confidence: 99%)",
    "",
  ];

  for (const prose of conflictingProseVariants) {
    const locale = detectPdfPresentationLocale(prose);
    const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
      canonicalState,
      prose,
      locale === "tr" ? "Turkish" : "English"
    );
    assert.equal(resolved.decisionSource, "canonical-state");
    assert.equal(resolved.decisionLabel, "MONITOR");
    assert.equal(resolved.canonicalDecision, "PROCEED_WITH_CONDITIONS");
    assert.notEqual(resolved.decisionLabel, "ENTER");
  }
});

test("REGRESSION: canonical AVOID (NO_GO) cannot render ENTER or MONITOR as the current verdict, regardless of conflicting prose", () => {
  const canonicalState = canonicalStateFor("NO_GO", { confidence: 12 });
  const conflictingProseVariants = [
    "Decision: ENTER the market immediately (Confidence: 90%).",
    "Decision: MONITOR for a staged pilot (Confidence: 40%).",
    "This market shows strong Go-to-Market potential across every segment.",
    "",
  ];

  for (const prose of conflictingProseVariants) {
    const locale = detectPdfPresentationLocale(prose);
    const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
      canonicalState,
      prose,
      locale === "tr" ? "Turkish" : "English"
    );
    assert.equal(resolved.decisionSource, "canonical-state");
    assert.equal(resolved.decisionLabel, "AVOID");
    assert.equal(resolved.canonicalDecision, "REJECT");
    assert.notEqual(resolved.decisionLabel, "ENTER");
    assert.notEqual(resolved.decisionLabel, "MONITOR");
  }
});

test("REGRESSION: canonical ENTER (GO) remains ENTER when legitimately supported by resolved decision-critical evidence, even against a weaker/conflicting prose statement", () => {
  const canonicalState = canonicalStateFor("GO", { confidence: 82 });
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    "Decision: MONITOR (Confidence: 20%)",
    "English"
  );
  assert.equal(resolved.decisionLabel, "ENTER");
  assert.equal(resolved.canonicalDecision, "PROCEED");
  assert.equal(resolved.confidenceScore, 82);
});

test("REGRESSION: missing critical evidence is never upgraded to ENTER merely because generated prose sounds positive (conservative evidence gating preserved)", () => {
  // No canonical state persisted (legacy report) -- an unverified strong
  // affirmative token with no confidence banner behind it must downgrade,
  // never pass through as ENTER.
  const canonicalState = readMarketIntelligenceCanonicalState({
    marketIntelligenceCanonicalStateStatus: "unavailable_no_graph",
  });
  assert.equal(canonicalState, null);

  const optimisticButUnverifiedProse =
    "Decision: ENTER this market -- the opportunity looks excellent based on strong preliminary signals.";
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    optimisticButUnverifiedProse,
    "English"
  );
  assert.equal(resolved.decisionSource, "raw-label");
  assert.notEqual(resolved.decisionLabel, "ENTER");
  assert.equal(resolved.decisionLabel, "MONITOR");
  assert.equal(resolved.confidenceScore, null);
});

test("REGRESSION: UI and PDF resolve the exact same decision -- dashboard home, workspace detail, report page, and PDF all call the SAME function with the SAME canonical state and get an identical result", () => {
  const canonicalState = canonicalStateFor("CONDITIONAL_GO", {
    confidence: 61,
    topRisks: ["Incumbent concentration", "Procurement cycle length", "Model trust"],
  });

  // Each "surface" is simulated with genuinely different prose content,
  // exactly as dashboard home (executive recommendation + summary),
  // workspace detail (same aliases), the report page (full executive
  // summary section), and the PDF (its own extracted section text) would
  // each independently assemble -- proving divergent input text cannot
  // produce a divergent decision once canonical state is present.
  const dashboardHomeContent = "Recommendation: proceed cautiously with a staged pilot.";
  const workspaceContent = "Executive Recommendation: staged entry pending SOM validation.\nMarket Overview: growing category.";
  const reportPageContent = "Full executive summary prose describing the opportunity and its risks at length.";
  const pdfContent = "A completely different prose variant, simulating PDF-side content extraction.";

  const results = [dashboardHomeContent, workspaceContent, reportPageContent, pdfContent].map((content) => {
    const locale = detectPdfPresentationLocale(content);
    return resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
      canonicalState,
      content,
      locale === "tr" ? "Turkish" : "English"
    );
  });

  for (const result of results) {
    assert.equal(result.decisionSource, "canonical-state");
    assert.equal(result.decisionLabel, "MONITOR");
    assert.equal(result.canonicalDecision, "PROCEED_WITH_CONDITIONS");
    assert.equal(result.confidenceScore, 61);
  }
});

test("REGRESSION: persisted -> reloaded reports preserve the exact same canonical decision (JSONB round-trip, exactly as worker.ts/Supabase behave)", () => {
  const built = canonicalStateFor("NO_GO", {
    confidence: 9,
    topRisks: ["No independent market-size verification"],
    immediateNextAction: "Do not proceed until independent market-size verification exists.",
  });

  const beforePersist = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(built, "", "English");
  assert.equal(beforePersist.decisionLabel, "AVOID");

  // Simulate the exact read path dashboard/page.tsx and
  // workspaces/[id]/page.tsx now use: report.metadata straight off a
  // reloaded Supabase row.
  const reloadedMetadata = JSON.parse(JSON.stringify({ marketIntelligenceCanonicalState: built }));
  const canonicalState = readMarketIntelligenceCanonicalState(reloadedMetadata);
  assert.ok(canonicalState);

  const afterReload = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(canonicalState, "", "English");
  assert.equal(afterReload.decisionLabel, "AVOID");
  assert.equal(afterReload.canonicalDecision, "REJECT");
  assert.equal(afterReload.confidenceScore, 9);
  assert.deepEqual(canonicalState.topRisks, built.topRisks);
  assert.equal(canonicalState.immediateNextAction, built.immediateNextAction);
});
