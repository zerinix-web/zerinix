import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createDirectReportReadiness,
  createUnderstandingFallback,
} from "../app/lib/ai/understanding.ts";

const plannerSource = await readFile(
  new URL("../components/Planner.tsx", import.meta.url),
  "utf8"
);
const planExecutorSource = await readFile(
  new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
  "utf8"
);
const marketRouteSource = await readFile(
  new URL("../app/api/market-analysis/route.ts", import.meta.url),
  "utf8"
);

test("the three authoritative analysis cards remain visible", () => {
  assert.match(plannerSource, /Business Idea Validation/);
  assert.match(plannerSource, /Market Intelligence/);
  assert.match(plannerSource, /Strategic Advisory/);
});

test("Send never renders the secondary clarification or recommendation UI", () => {
  assert.doesNotMatch(plannerSource, /<RecommendationCard/);
  assert.doesNotMatch(plannerSource, /pendingRecommendation/);
  assert.doesNotMatch(plannerSource, /generateRecommendedReport/);
  assert.doesNotMatch(plannerSource, /understanding\.recommendedAction === "clarify"/);
});

test("Business Idea and Market Intelligence create non-blocking direct report readiness", () => {
  for (const selectedMode of ["plan", "market"]) {
    const understanding = createUnderstandingFallback({
      prompt:
        selectedMode === "plan"
          ? "KOBİ'ler için bir karar destek ürünü geliştirmek istiyorum"
          : "Avrupa karar destek yazılımı pazarını analiz et",
      selectedMode,
    });
    const readiness = createDirectReportReadiness(understanding);

    assert.equal(readiness.reportPlan.selectedMode, selectedMode);
    assert.deepEqual(readiness.requiredQuestionIds, []);
    assert.equal(readiness.confirmed, true);
  }

  assert.doesNotMatch(planExecutorSource, /isWeakBusinessPrompt|clarificationMessage\(\)/);
  assert.doesNotMatch(marketRouteSource, /isWeakMarketPrompt|clarificationMessage\(\)/);
});

test("Strategic Advisory dispatches directly to chat and cannot be overridden", () => {
  assert.match(
    plannerSource,
    /if \(selectedMode === "chat"\)[\s\S]*await sendChatMessage\([\s\S]*queuedAttachments/
  );
  assert.match(
    plannerSource,
    /createDirectReportReadiness\(understanding\)[\s\S]*generatePlan\([\s\S]*selectedMode/
  );
  assert.doesNotMatch(plannerSource, /setActiveMode\([^)]*understanding/);
});

test("direct dispatch preserves attachments, history, and the existing report pipeline", () => {
  assert.match(plannerSource, /const queuedAttachments = \[\.\.\.attachments\]/);
  assert.match(plannerSource, /sendChatMessage\([\s\S]*queuedAttachments/);
  assert.match(plannerSource, /generatePlan\([\s\S]*queuedAttachments/);
  assert.match(plannerSource, /useConversations\(/);
  assert.match(plannerSource, /persistAnalysisContext\(/);
});

test("internal understanding metadata is not appended to the visible request", () => {
  assert.doesNotMatch(plannerSource, /ZERINIX validated request context/);
  assert.doesNotMatch(plannerSource, /Likely domain|Likely content type/);
  assert.doesNotMatch(plannerSource, /Inferred decision goal|Unresolved information/);
});
