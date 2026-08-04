import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  applyDocumentAwareModeOverride,
  classifyAttachmentDocument,
} from "../app/lib/ai/document-intelligence.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

const yargitayDecisionAsset = {
  name: "yargitay_karari.jpg",
  mimeType: "image/jpeg",
  textContent: `T.C. YARGITAY 9. HUKUK DAİRESİ
ESAS NO: 2019/1234
KARAR NO: 2020/5678
DAVACI: Ahmet Yılmaz
DAVALI: ABC Şirketi Ltd.
Taraflar arasındaki davanın temyizen incelenmesi sonucunda, Bölge Adliye Mahkemesi kararının onandığına dair hüküm kurulmuştur.`,
};

test("the uploaded Yargıtay decision image with a generic prompt routes to legal_case_analysis", () => {
  const classification = classifyAttachmentDocument({
    assets: [yargitayDecisionAsset],
  });
  const routing = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification,
  });

  assert.equal(classification.category, "legal_document");
  assert.ok(classification.confidence >= 0.7);
  assert.equal(routing.analysisType, "legal_case_analysis");
  assert.equal(routing.documentCategory, "legal_document");
  assert.equal(routing.selectedMode, "chat");
  assert.equal(routing.overridden, true);
});

test("the same Yargıtay decision request never creates a business-plan report", () => {
  const classification = classifyAttachmentDocument({
    assets: [yargitayDecisionAsset],
  });
  const routingFromPlanMode = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification,
  });
  const routingFromMarketMode = applyDocumentAwareModeOverride({
    selectedMode: "market",
    classification,
  });

  assert.notEqual(routingFromPlanMode.selectedMode, "plan");
  assert.notEqual(routingFromPlanMode.selectedMode, "market");
  assert.notEqual(routingFromMarketMode.selectedMode, "plan");
  assert.notEqual(routingFromMarketMode.selectedMode, "market");
  assert.notEqual(routingFromPlanMode.documentCategory, "business_document");
});

test("a genuine business idea with no legal attachment still routes to Business Idea Validation", () => {
  const classification = classifyAttachmentDocument({ assets: [] });
  const routing = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification,
  });

  assert.equal(classification.category, "unknown_document");
  assert.equal(routing.selectedMode, "plan");
  assert.equal(routing.overridden, false);
});

test("a business-plan attachment under Business Idea Validation mode is labeled but does not force a mode change", () => {
  const classification = classifyAttachmentDocument({
    assets: [
      {
        name: "pitch_deck.pdf",
        mimeType: "application/pdf",
        textContent:
          "Business Plan Executive Summary. Our pitch deck outlines the go-to-market strategy, term sheet expectations, and cap table.",
      },
    ],
  });
  const routing = applyDocumentAwareModeOverride({
    selectedMode: "plan",
    classification,
  });

  assert.equal(classification.category, "business_document");
  assert.equal(routing.selectedMode, "plan");
  assert.equal(routing.overridden, false);
});

test("no attachment keeps existing routing behavior for every selected mode", () => {
  for (const selectedMode of ["plan", "market", "chat", undefined]) {
    const classification = classifyAttachmentDocument({ assets: [] });
    const routing = applyDocumentAwareModeOverride({
      selectedMode,
      classification,
    });

    assert.equal(classification.category, "unknown_document");
    assert.equal(classification.confidence, 0);
    assert.equal(routing.overridden, false);
    assert.equal(
      routing.selectedMode,
      selectedMode === "plan" || selectedMode === "market" || selectedMode === "chat"
        ? selectedMode
        : "chat"
    );
  }
});

test("low-confidence attachment content is marked unknown_document rather than guessed", () => {
  const classification = classifyAttachmentDocument({
    assets: [
      {
        name: "notes.txt",
        mimeType: "text/plain",
        textContent: "Some unrelated notes about groceries and travel plans.",
      },
    ],
  });

  assert.equal(classification.category, "unknown_document");
  assert.equal(classification.analysisType, null);
});

test("app/api/plan/route.ts classifies attachments and overrides analysisMode before any other read of body.analysisMode", () => {
  const classifyIndex = planRouteSource.indexOf("classifyAttachmentDocument({");
  const overrideIndex = planRouteSource.indexOf("applyDocumentAwareModeOverride({");
  const marketCheckIndex = planRouteSource.indexOf(
    "normalizeSelectedAnalysisMode(body.analysisMode) === \"market\""
  );
  const expertiseProfileReadIndex = planRouteSource.indexOf(
    "readRequestExpertiseProfile(body)"
  );

  assert.ok(classifyIndex > -1, "classifyAttachmentDocument must be called in the route");
  assert.ok(overrideIndex > -1, "applyDocumentAwareModeOverride must be called in the route");
  assert.ok(classifyIndex < marketCheckIndex);
  assert.ok(overrideIndex < marketCheckIndex);
  assert.ok(classifyIndex < expertiseProfileReadIndex);
  assert.ok(overrideIndex < expertiseProfileReadIndex);
  assert.match(
    planRouteSource,
    /if \(documentAwareRouting\.overridden\) \{\s*body\.analysisMode = documentAwareRouting\.selectedMode;\s*\}/
  );
});

test("document classification does not touch report generation, PDF design, or billing files", () => {
  const touchedFiles = [
    "app/lib/pdf-engine",
    "app/lib/report-engine",
    "app/lib/billing",
    "app/lib/ai/market-analysis",
    "app/lib/ai/adaptive-report-writer",
  ];

  for (const path of touchedFiles) {
    assert.doesNotMatch(planRouteSource, new RegExp(path.replace(/\//g, "\\/")));
  }
});
