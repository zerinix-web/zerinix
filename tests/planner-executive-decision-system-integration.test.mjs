import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeSelectedAnalysisMode } from "../app/lib/ai/expertise-profile.ts";

// This is a dedicated integration test tying the ACTUAL Planner UI
// component's request contract to the backend Executive Decision
// System gate, for the "integrate EDS into the Planner production
// flow without changing UX" task. All of the backend wiring (route.ts
// gating, worker.ts's 6-module chain, PDF/dashboard consumption) was
// already built and verified in prior work; this file specifically
// proves the piece that hadn't been checked yet: that
// components/Planner.tsx (a) sends exactly the analysisMode value the
// backend gate expects for Business Idea Validation, (b) only ever
// makes ONE full-report request per submission (never a second,
// per-field path that could bypass the gate), and (c) never reads any
// of the 6 new EDS metadata fields -- so its rendering is structurally
// unaffected by whether EDS ran on a given report, matching "keep the
// current UX, streaming behavior, and report generation flow
// unchanged" exactly, not just by convention but by construction.

const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const planRouteSource = readFileSync("app/api/plan/route.ts", "utf8");

test("Planner.tsx defaults its report request to analysisMode 'plan' (Business Idea Validation) -- the exact value the EDS/Decision Engine route gate requires", () => {
  assert.match(plannerSource, /requestedMode:\s*ChatMode\s*=\s*"plan"/);
  assert.match(plannerSource, /analysisMode:\s*requestedMode,/);

  // Cross-reference: the backend gate this request must satisfy.
  const edsIndex = planRouteSource.indexOf("const isSupportedExecutiveDecisionSystemContext =");
  assert.ok(edsIndex >= 0);
  const edsPredicate = planRouteSource.slice(edsIndex, planRouteSource.indexOf(";", edsIndex));
  assert.match(edsPredicate, /normalizeSelectedAnalysisMode\(body\.analysisMode\) === "plan"/);

  assert.equal(normalizeSelectedAnalysisMode("plan"), "plan");
});

test("Planner.tsx makes exactly one full-report request per submission -- there is no separate per-field streaming path that could bypass the EDS gate", () => {
  const fullReportCalls = (plannerSource.match(/field:\s*"fullReport"/g) || []).length;
  assert.equal(fullReportCalls, 1);

  const planApiCalls = (plannerSource.match(/const planRequestUrl = "\/api\/plan";/g) || []).length;
  assert.equal(planApiCalls, 1);
});

test("Planner.tsx's report-completion handling reads only 'sections' from the completed report, never any of the 6 EDS metadata fields -- its own rendering is structurally unaffected by whether EDS ran", () => {
  const streamStart = plannerSource.indexOf("const streamFullReport = async () => {");
  const streamEnd = plannerSource.indexOf("\n    };", streamStart);
  assert.ok(streamStart >= 0 && streamEnd > streamStart);
  const streamBody = plannerSource.slice(streamStart, streamEnd);

  assert.match(streamBody, /persistedReport\.sections/);
  for (const field of [
    "reportQualityValidation",
    "reportConsistencyCheck",
    "reportAuditTrail",
    "reportExplainability",
    "reportReproducibility",
    "reportVersion",
  ]) {
    assert.doesNotMatch(streamBody, new RegExp(field));
  }
});

test("Planner.tsx's own separate metadata consumption (benchmarkFit/benchmarkScore/reportQuality preview panels) reads only pre-existing legacy fields, never any of the 6 EDS metadata fields", () => {
  assert.match(plannerSource, /currentReportMetadata\?\.benchmarkFit/);
  assert.match(plannerSource, /currentReportMetadata\?\.reportQuality/);
  for (const field of [
    "reportQualityValidation",
    "reportConsistencyCheck",
    "reportAuditTrail",
    "reportExplainability",
    "reportReproducibility",
    "reportVersion",
  ]) {
    assert.doesNotMatch(plannerSource, new RegExp(`currentReportMetadata\\?\\.${field}`));
    assert.doesNotMatch(plannerSource, new RegExp(`initialReport\\?\\.metadata\\?\\.${field}`));
  }
});

test("no new EDS-related import or reference exists in components/Planner.tsx -- the integration is entirely server-side, requiring zero client changes", () => {
  const moduleNames = [
    "executive-decision-system",
    "strategic-decision-memo",
    "executive-brief-generator",
    "executive-report-quality-validator",
    "report-consistency-checker",
    "report-audit-trail",
    "explainability-engine",
    "decision-reproducibility-engine",
    "report-versioning-engine",
    "executive-decision-intelligence-presentation",
  ];
  for (const moduleName of moduleNames) {
    assert.doesNotMatch(plannerSource, new RegExp(moduleName, "i"));
  }
});
