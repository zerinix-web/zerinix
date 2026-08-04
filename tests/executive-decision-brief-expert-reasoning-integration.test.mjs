import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";
import { runExpertReasoningEngine } from "../app/lib/ai/expert-reasoning-engine.ts";
import {
  buildExecutiveDecisionBrief,
  buildExecutiveDecisionBriefFromExpertReasoning,
  executiveDecisionBriefSchema,
} from "../app/lib/ai/executive-decision-brief.ts";

const briefSource = await readFile(
  new URL("../app/lib/ai/executive-decision-brief.ts", import.meta.url),
  "utf8"
);
const engineSource = await readFile(
  new URL("../app/lib/ai/expert-reasoning-engine.ts", import.meta.url),
  "utf8"
);
const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function context(assets, prompt) {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({ assets });
  const decisionPlan = buildDecisionPlan({ prompt, documentIntelligence });
  return { documentIntelligence, decisionPlan };
}

const STRONG_EVIDENCE_TEXT = `Subject: Market Entry Business Case for the SaaS Product

BUSINESS SUMMARY

This business plan describes a go-to-market plan. Evidence supporting demand is attached, including signed letters of intent from three customers.

According to the attached market research report, addressable demand exceeds $50,000,000. The board approved the go-to-market strategy on 2024-09-01.`;

const THIN_EVIDENCE_TEXT = "Subject: New Business Idea\n\nBusiness plan idea. It could be a good business model.";

const RISK_HEAVY_TEXT = `Subject: Expansion Risk Review

BUSINESS SUMMARY

This business plan describes a proposed market expansion and business model. There is a material risk of regulatory non-compliance in this market. There is also a significant liability exposure from the proposed partnership. There is a further breach penalty risk if the agreement is signed as drafted.`;

const LEGAL_DOCUMENT_TEXT =
  "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.";

test("Executive Decision Brief is built from the ExpertReasoningResult, not computed independently", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "market_report.pdf", textContent: STRONG_EVIDENCE_TEXT }],
    "Please evaluate whether we should proceed with this business idea."
  );

  const expertReasoningResult = runExpertReasoningEngine({
    prompt: "Please evaluate whether we should proceed with this business idea.",
    documentIntelligence,
    decisionPlan,
  });
  const directBrief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);
  const pipelineBrief = buildExecutiveDecisionBrief({
    decisionPlan,
    documentIntelligence,
    prompt: "Please evaluate whether we should proceed with this business idea.",
  });

  assert.deepEqual(pipelineBrief, directBrief);
  assert.match(briefSource, /runExpertReasoningEngine\(/);
  assert.match(briefSource, /buildExecutiveDecisionBriefFromExpertReasoning\(/);
});

test("recommendations retain a complete evidence trace matching the expert reasoning engine's own trace", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "market_report.pdf", textContent: STRONG_EVIDENCE_TEXT }],
    "Please evaluate this business opportunity."
  );
  const expertReasoningResult = runExpertReasoningEngine({
    prompt: "Please evaluate this business opportunity.",
    documentIntelligence,
    decisionPlan,
  });
  const brief = buildExecutiveDecisionBriefFromExpertReasoning(expertReasoningResult);

  assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
  assert.ok(brief.evidenceTrace.length > 0);
  assert.deepEqual(brief.evidenceTrace, expertReasoningResult.evidenceTrace);
  assert.ok(brief.evidenceTrace.some((line) => /verifiedFacts/.test(line)));
  assert.ok(brief.evidenceTrace.some((line) => /recommendationStatus/.test(line)));
});

test("assumptions never become verified facts through the integration", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "market_report.pdf", textContent: STRONG_EVIDENCE_TEXT }],
    "Please evaluate this business opportunity."
  );
  const brief = buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence });

  assert.ok(brief.assumptions.length > 0);
  assert.ok(brief.verifiedEvidence.length > 0);
  for (const assumption of brief.assumptions) {
    assert.ok(!brief.verifiedEvidence.includes(assumption));
    assert.ok(!brief.directionalSignals.includes(assumption));
    assert.match(assumption, /assum/i);
  }
});

test("missing critical evidence produces 'wait' or 'insufficient_evidence', never a positive recommendation", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "note.txt", textContent: THIN_EVIDENCE_TEXT }],
    "Should we invest in this?"
  );
  const brief = buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence });

  assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
  if (brief.verifiedEvidence.length === 0) {
    assert.ok(
      brief.recommendationStatus === "insufficient_evidence" || brief.recommendationStatus === "wait"
    );
  }
  assert.notEqual(brief.recommendationStatus, "proceed");
});

test("strong, verified business evidence can produce 'proceed' or 'proceed_with_conditions'", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "market_report.pdf", textContent: STRONG_EVIDENCE_TEXT }],
    "Please evaluate whether we should proceed with this business idea."
  );
  const brief = buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence });

  assert.ok(brief.verifiedEvidence.length > 0);
  assert.ok(["proceed", "proceed_with_conditions"].includes(brief.recommendationStatus));
  assert.match(brief.executiveRecommendation, /proceed/i);
});

test("major identified risk without offsetting evidence never reaches 'proceed'", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "risk_memo.pdf", textContent: RISK_HEAVY_TEXT }],
    "Should we proceed with this expansion?"
  );
  const brief = buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence });

  assert.notEqual(brief.recommendationStatus, "proceed");
  assert.ok(brief.keyRisks.length >= 2);
});

test("an unsupported document (Legal) produces no fabricated business decision", () => {
  const { documentIntelligence, decisionPlan } = context(
    [{ name: "contract.pdf", textContent: LEGAL_DOCUMENT_TEXT }],
    "Please review this."
  );
  const brief = buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence });

  assert.equal(decisionPlan.detectedDomain, "Legal");
  assert.equal(brief.recommendationStatus, "insufficient_evidence");
  assert.deepEqual(brief.verifiedEvidence, []);
  assert.deepEqual(brief.keyRisks, []);
  assert.deepEqual(brief.immediateNextActions, []);
  assert.doesNotMatch(brief.executiveRecommendation, /\$\d|market size/i);
});

test("generic placeholder advice does not appear without supporting evidence: the executive recommendation always cites the actual recommended option's rationale", () => {
  const strong = context(
    [{ name: "market_report.pdf", textContent: STRONG_EVIDENCE_TEXT }],
    "Please evaluate this business opportunity."
  );
  const thin = context([{ name: "note.txt", textContent: THIN_EVIDENCE_TEXT }], "Should we invest in this?");

  const strongBrief = buildExecutiveDecisionBrief({
    decisionPlan: strong.decisionPlan,
    documentIntelligence: strong.documentIntelligence,
  });
  const thinBrief = buildExecutiveDecisionBrief({
    decisionPlan: thin.decisionPlan,
    documentIntelligence: thin.documentIntelligence,
  });

  assert.notEqual(strongBrief.executiveRecommendation, thinBrief.executiveRecommendation);
  for (const brief of [strongBrief, thinBrief]) {
    assert.doesNotMatch(brief.executiveRecommendation, /move fast|hustle|disrupt|10x|growth hack/i);
  }
});

test("the expert reasoning engine no longer depends on executive-decision-brief.ts (dependency runs one way only)", () => {
  assert.doesNotMatch(engineSource, /from ["'].*executive-decision-brief/);
});

test("app/api/plan/route.ts is not connected to this integration yet", () => {
  assert.doesNotMatch(planRouteSource, /executive-decision-brief/);
  assert.doesNotMatch(planRouteSource, /expert-reasoning-engine/);
  assert.doesNotMatch(planRouteSource, /buildExecutiveDecisionBrief|runExpertReasoningEngine/);
});
