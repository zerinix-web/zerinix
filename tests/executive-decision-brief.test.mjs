import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createUniversalDocumentIntelligenceFallback } from "../app/lib/ai/universal-document-intelligence.ts";
import { buildDecisionPlan } from "../app/lib/ai/intelligence-router.ts";
import {
  buildExecutiveDecisionBrief,
  executiveDecisionBriefSchema,
  recommendationStatusValues,
} from "../app/lib/ai/executive-decision-brief.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

function briefFor(assets, prompt) {
  const documentIntelligence = createUniversalDocumentIntelligenceFallback({ assets });
  const decisionPlan = buildDecisionPlan({ prompt, documentIntelligence });
  return {
    documentIntelligence,
    decisionPlan,
    brief: buildExecutiveDecisionBrief({ decisionPlan, documentIntelligence }),
  };
}

test("recommendationStatusValues contains exactly the required 5 statuses", () => {
  assert.deepEqual(
    [...recommendationStatusValues].sort(),
    ["proceed", "proceed_with_conditions", "wait", "reject", "insufficient_evidence"].sort()
  );
});

test("strong, multi-source business evidence with no risk language produces 'proceed'", () => {
  const { brief } = briefFor(
    [
      {
        name: "market_report.pdf",
        textContent: `Subject: Market Entry Business Case for Acme Corporation

BUSINESS SUMMARY

Acme Corporation's business plan targets the SaaS market with a validated business model. Evidence supporting demand is attached, including signed letters of intent from three customers.

According to the attached market research report, addressable demand exceeds $50,000,000. The board approved the go-to-market strategy on 2024-09-01.`,
      },
    ],
    "Please evaluate whether we should proceed with this business idea."
  );

  assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
  assert.equal(brief.recommendationStatus, "proceed");
  assert.ok(brief.verifiedEvidence.length >= 2);
  assert.equal(brief.keyRisks.length, 0);
  assert.match(brief.executiveRecommendation, /proceed/i);
});

test("a thin, evidence-free note produces 'insufficient_evidence' rather than a fabricated recommendation", () => {
  const { brief } = briefFor(
    [
      {
        name: "brief_note.txt",
        textContent: "Subject: New Business Idea\n\nWe have an idea for a business. It could be big.",
      },
    ],
    "Should we invest in this?"
  );

  assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
  assert.equal(brief.verifiedEvidence.length, 0);
  assert.ok(
    brief.recommendationStatus === "insufficient_evidence" || brief.recommendationStatus === "wait"
  );
  assert.doesNotMatch(brief.executiveRecommendation, /\$\d|%|proceed\./i);
});

test("major, quantified risk with no offsetting evidence produces 'wait' or 'reject', never 'proceed'", () => {
  const { brief } = briefFor(
    [
      {
        name: "risk_memo.pdf",
        textContent: `Subject: Expansion Risk Review for Acme Corporation

BUSINESS SUMMARY

This business plan describes Acme Corporation's proposed market expansion and business model. There is a material risk of regulatory non-compliance in this market. There is also a significant liability exposure from the proposed partnership. Acme Corporation faces a breach penalty if the agreement is signed as drafted.`,
      },
    ],
    "Should we proceed with this expansion?"
  );

  assert.equal(executiveDecisionBriefSchema.safeParse(brief).success, true);
  assert.notEqual(brief.recommendationStatus, "proceed");
  assert.ok(brief.keyRisks.length >= 2);
});

test("assumptions are always structurally separate from verifiedEvidence and are never presented as verified facts", () => {
  const { brief } = briefFor(
    [
      {
        name: "market_report.pdf",
        textContent: `Subject: Market Entry Business Case for Acme Corporation

Evidence supporting demand is attached, including signed letters of intent from three customers. According to the attached market research report, addressable demand exceeds $50,000,000.`,
      },
    ],
    "Please evaluate this business opportunity."
  );

  assert.ok(brief.assumptions.length > 0);
  for (const assumption of brief.assumptions) {
    assert.ok(
      !brief.verifiedEvidence.includes(assumption),
      "an assumption must never also appear as verified evidence"
    );
    assert.match(assumption, /assum/i);
  }
});

test("an unsupported document category (Legal) never receives a fabricated business recommendation", () => {
  const { brief, decisionPlan } = briefFor(
    [
      {
        name: "contract.pdf",
        textContent:
          "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.",
      },
    ],
    "Please review this."
  );

  assert.equal(decisionPlan.detectedDomain, "Legal");
  assert.equal(brief.recommendationStatus, "insufficient_evidence");
  assert.deepEqual(brief.verifiedEvidence, []);
  assert.deepEqual(brief.keyRisks, []);
  assert.deepEqual(brief.immediateNextActions, []);
  assert.doesNotMatch(brief.executiveRecommendation, /\$\d|market size|competitor/i);
});

test("a request with no attachment and no business-relevant signal never receives fabricated advice", () => {
  const { brief } = briefFor([], "Should I start a coffee shop?");

  assert.equal(brief.recommendationStatus, "insufficient_evidence");
  assert.deepEqual(brief.verifiedEvidence, []);
  assert.deepEqual(brief.assumptions, []);
  assert.equal(brief.decisionConfidence, 0);
});

test("every recommendation includes an evidence trace: verifiedEvidence/directionalSignals/keyRisks are drawn from documentIntelligence, and decisionConfidence is a pass-through of the decision plan's own confidence", () => {
  const { brief, decisionPlan, documentIntelligence } = briefFor(
    [
      {
        name: "market_report.pdf",
        textContent: `Subject: Market Entry Business Case for Acme Corporation

Evidence supporting demand is attached, including signed letters of intent from three customers. There is a material risk of currency exposure. The board approved the go-to-market strategy on 2024-09-01.`,
      },
    ],
    "Please evaluate this business opportunity."
  );

  for (const item of brief.verifiedEvidence) {
    assert.ok(documentIntelligence.evidence.includes(item));
  }
  for (const item of brief.keyRisks) {
    assert.ok(documentIntelligence.risks.includes(item));
  }
  for (const item of brief.directionalSignals) {
    assert.ok(
      documentIntelligence.decisions.includes(item) ||
        documentIntelligence.obligations.includes(item)
    );
  }
  assert.equal(brief.decisionConfidence, decisionPlan.confidence);
});

test("immediate next actions are limited to at most 3 and are specific, not generic startup advice", () => {
  const { brief } = briefFor(
    [
      {
        name: "risk_memo.pdf",
        textContent: `Subject: Expansion Risk Review

BUSINESS SUMMARY

This business plan describes Acme Corporation's business model. There is a material risk of regulatory non-compliance. There is a significant liability exposure. There is also a breach penalty risk. There is a further hazard from currency exposure.`,
      },
    ],
    "Please evaluate this expansion."
  );

  assert.ok(brief.immediateNextActions.length > 0);

  assert.ok(brief.immediateNextActions.length <= 3);
  for (const action of brief.immediateNextActions) {
    assert.doesNotMatch(action, /move fast|hustle|disrupt|10x|growth hack/i);
  }
});

test("app/api/plan/route.ts is not modified to wire layer 6 into report generation, PDF, billing, or language logic", () => {
  assert.doesNotMatch(planRouteSource, /executive-decision-brief/);
  assert.doesNotMatch(planRouteSource, /buildExecutiveDecisionBrief/);
});

test("layer 6 does not add legal, medical, engineering, HR, or other specialist decision systems", async () => {
  const moduleSource = await readFile(
    new URL("../app/lib/ai/executive-decision-brief.ts", import.meta.url),
    "utf8"
  );

  assert.doesNotMatch(moduleSource, /legal-document-understanding|legal-case-analysis/);
  for (const forbidden of ["Medical Intelligence", "HR Intelligence", "Real Estate Intelligence", "Technical Intelligence", "Legal Intelligence"]) {
    assert.doesNotMatch(
      moduleSource,
      new RegExp(`SUPPORTED_BUSINESS_(?:DOMAINS|MODULES)[\\s\\S]{0,200}${forbidden}`)
    );
  }
});
