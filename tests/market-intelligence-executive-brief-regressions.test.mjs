import assert from "node:assert/strict";
import test from "node:test";

import { formatExecutiveDecisionBrief } from "../app/lib/report-engine/executive-decision-brief.ts";
import { buildMarketExecutiveDecisionBrief } from "../app/lib/report-engine/market-intelligence-presentation.ts";

test("formatExecutiveDecisionBrief never double-numbers a reason/risk/gap that already carries its own list marker", () => {
  // Reproduces a real, live-observed defect: topReasons/topRisks entries
  // extracted from a source section that is itself a numbered list ("1) ...")
  // kept their own marker, and the deterministic "N. " prefix stacked on
  // top of it, rendering as "1. 1) Compliance-packaged offerings...".
  const brief = {
    decision: "GO",
    confidence: 66,
    confidenceDirection: "supported",
    confidenceFactors: ["strong evidence"],
    why: "Evidence supports entry.",
    topReasons: ["1) Compliance-packaged offerings mapped to NIST SP 800-171 and SOC 2."],
    topRisks: ["1) Commoditization by cloud platform secret services."],
    missingEvidence: [],
    whatWouldChangeThisDecision: "A material worsening of the primary risk.",
    immediateNextAction: "Begin execution immediately.",
  };

  const formatted = formatExecutiveDecisionBrief(brief, "English");

  assert.ok(!/\d\.\s*\d+[.)]/.test(formatted), `double-numbering found in:\n${formatted}`);
  assert.match(formatted, /1\.\s*Compliance-packaged offerings/);
  assert.match(formatted, /1\.\s*Commoditization by cloud platform/);
});

test("formatExecutiveDecisionBrief preserves normal (non-numbered) reason/risk text unchanged", () => {
  const brief = {
    decision: "GO",
    confidence: 80,
    confidenceDirection: "supported",
    confidenceFactors: [],
    why: "Evidence supports entry.",
    topReasons: ["Strong compliance-driven demand in North America."],
    topRisks: ["Cloud-provider commoditization pressure."],
    missingEvidence: [],
    whatWouldChangeThisDecision: "A material shift in competitive dynamics.",
    immediateNextAction: "Begin execution.",
  };

  const formatted = formatExecutiveDecisionBrief(brief, "English");
  assert.match(formatted, /1\. Strong compliance-driven demand in North America\./);
  assert.match(formatted, /1\. Cloud-provider commoditization pressure\./);
});

function makeCoverage(overrides = {}) {
  return {
    dimensions: {
      marketConfidence: 55,
      competitiveEvidence: 55,
      financialEvidence: 55,
      productEvidence: 55,
      executionReadiness: 0,
      founderReadiness: 0,
      ...overrides.dimensions,
    },
    verifiedMarketSizeAvailable: overrides.verifiedMarketSizeAvailable ?? true,
  };
}

const sections = {
  opportunities: "1) A real, evidence-backed opportunity exists in this market [R1].",
  threats: "1) A real, evidence-backed risk exists in this market [R2].",
};

test("a MONITOR-band decision (all dimensions individually pass but blended confidence isn't a clean GO) never reports an empty missing-evidence list", () => {
  // Reproduces a real gap: every per-dimension check requires < 50 to fire,
  // but the blended confidence formula (0.4/0.25/0.2/0.15 weights) can put
  // the decision below the GO threshold even when every single dimension
  // individually clears 50 -- previously this produced zero gaps for a
  // report that was explicitly NOT a clean GO.
  const coverage = makeCoverage({ dimensions: { marketConfidence: 55, competitiveEvidence: 55, financialEvidence: 55, productEvidence: 55 } });
  const brief = buildMarketExecutiveDecisionBrief(sections, "English", coverage);

  assert.notEqual(brief.decision, "GO");
  assert.ok(brief.missingEvidence.length > 0, "missingEvidence must not be empty for a non-GO decision");
});

test("a clean, high-confidence GO with strong dimensions legitimately reports no missing evidence", () => {
  const coverage = makeCoverage({ dimensions: { marketConfidence: 90, competitiveEvidence: 90, financialEvidence: 90, productEvidence: 90 } });
  const brief = buildMarketExecutiveDecisionBrief(sections, "English", coverage);

  assert.equal(brief.decision, "GO");
  assert.deepEqual(brief.missingEvidence, []);
});

test("a clearly weak dimension still reports its own named gap (unchanged pre-existing behavior)", () => {
  const coverage = makeCoverage({ dimensions: { marketConfidence: 30, competitiveEvidence: 55, financialEvidence: 55, productEvidence: 55 } });
  const brief = buildMarketExecutiveDecisionBrief(sections, "English", coverage);

  assert.ok(brief.missingEvidence.some((gap) => /below the threshold/i.test(gap)));
});
