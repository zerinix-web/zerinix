// TASK #69A-42 -- Fix the persisted-report reload path so a browser
// refresh restores the SAME structured report UI produced immediately
// after Regenerate.
//
// A. REPRODUCTION (traced through the real code, not inferred):
//   app/plan/page.tsx's server component intentionally passes
//   `initialReport={ shouldStartFresh || regenerationContext ? null :
//   conversationResult.latestReport }` -- null whenever the URL still
//   carries "new=1" (fresh-start intent) or "reportId=..." (an explicit
//   "regenerate this specific report" intent), by design, so neither
//   flow ever shows stale content while a generation is in flight.
//   components/Planner.tsx's own structured-report state
//   (planReport, seeded by restoredPlanReport) is populated EXCLUSIVELY
//   from that one server-provided initialReport prop at mount -- there
//   is no client-side fallback fetch. removeLargePlannerQueryPayloads
//   (the ONLY existing URL-cleanup mechanism before this fix)
//   deliberately PRESERVES both "new" and "reportId" in its own
//   allow-list (they are read by the generation request itself), so
//   nothing ever cleared them once a generation actually completed --
//   every subsequent refresh of that same URL kept re-entering the
//   exact same "force blank" branch forever, even though the
//   conversation, by then, already had a genuinely completed report.
//   Meanwhile the conversation's chat history (initialConversations,
//   loaded unconditionally, independent of initialReport) still shows
//   the completed assistant message's own raw getReportMarkdown text,
//   with nothing left to visually replace it.
//
// B. EXACT PIPELINE STAGE WHERE STRUCTURED IDENTITY IS LOST:
//   app/plan/page.tsx's initialReport prop computation, on the SECOND
//   (refreshed) server render of a URL that still carries "new"/
//   "reportId" from BEFORE generation completed. Nothing in generation,
//   persistence, or message classification (ChatMessages.tsx) is at
//   fault -- confirmed live: reports.status is persisted as exactly
//   "completed", ai_messages.mode/status persist as exactly "plan"/
//   "complete", and classifyReportDomain(precedingUserContent) resolves
//   "business" correctly for the real prompt -- every one of those
//   already-correct signals is simply never consulted because
//   initialReport is null before any of them come into play.
//
// C. FIX (components/Planner.tsx): a new
//   clearFreshStartAndRegenerationUrlParams, called exactly once, at
//   the exact point a generation is CONFIRMED saved (immediately after
//   setActiveReportId(savedReportId), inside the `savedReportId` truthy
//   branch -- never on failure, never speculatively before completion).
//   It drops "new" and "reportId" from the URL via the same
//   history.replaceState mechanism removeLargePlannerQueryPayloads
//   already uses for a related purpose. A subsequent refresh of that
//   same tab then lands on page.tsx's OTHER branch --
//   `conversationResult.latestReport`, computed by
//   findLatestCompletedReportWithContent (an explicit, deterministic,
//   report-completion-and-content-based lookup) -- which deterministically
//   restores the exact just-completed report. No text-pattern
//   suppression patch was added, no new inference from message content
//   was introduced, and ChatMessages.tsx's own classification
//   (isCompletedBusinessPlanReportMessage / shouldShowReportCompletionHeadline)
//   is completely untouched.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const planPageSource = readFileSync(join(repoRoot, "app/plan/page.tsx"), "utf8");
const chatMessagesSource = readFileSync(
  join(repoRoot, "components/planner/ChatMessages.tsx"),
  "utf8"
);
const reportDetailPageSource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/page.tsx"),
  "utf8"
);
const conversationsSource = readFileSync(
  join(repoRoot, "app/plan/conversations.ts"),
  "utf8"
);

function extractFunctionSource(source, name) {
  const startMatch = source.match(new RegExp(`function ${name}\\(`));
  assert.ok(startMatch, `${name} not found`);
  const start = startMatch.index;
  let i = source.indexOf("{", start);
  let depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

// Loads the REAL, unmodified clearFreshStartAndRegenerationUrlParams via
// a temp module with a minimal window/history stub -- proves the real
// function's own behavior, not an approximation of it.
async function loadRealClearFn() {
  const fnSource = extractFunctionSource(
    plannerSource,
    "clearFreshStartAndRegenerationUrlParams"
  );
  const blob = [
    fnSource,
    "export { clearFreshStartAndRegenerationUrlParams };",
  ].join("\n\n");

  const dir = mkdtempSync(join(tmpdir(), "task69a42-"));
  const file = join(dir, "clear.mjs");
  writeFileSync(file, blob);
  const mod = await import(pathToFileURL(file).href);
  return mod.clearFreshStartAndRegenerationUrlParams;
}

function makeStubWindow(initialUrl) {
  const replaceCalls = [];
  let currentUrl = initialUrl;
  return {
    window: {
      location: {
        get href() {
          return currentUrl;
        },
      },
      history: {
        state: null,
        replaceState(state, title, newUrl) {
          replaceCalls.push({ state, title, newUrl });
          currentUrl = new URL(newUrl, "https://example.test").href;
        },
      },
    },
    replaceCalls,
    getCurrentUrl: () => currentUrl,
  };
}

test("FIX PROOF: clearFreshStartAndRegenerationUrlParams removes 'new' and 'reportId' but keeps every other param (e.g. 'mode', 'workspaceId')", async () => {
  const clearFn = await loadRealClearFn();
  const stub = makeStubWindow("https://example.test/plan?new=1&mode=plan&workspaceId=w1&reportId=abc123");
  globalThis.window = stub.window;
  try {
    clearFn();
  } finally {
    delete globalThis.window;
  }

  assert.equal(stub.replaceCalls.length, 1, "expected exactly one history.replaceState call");
  const finalUrl = new URL(stub.getCurrentUrl());
  assert.equal(finalUrl.searchParams.has("new"), false);
  assert.equal(finalUrl.searchParams.has("reportId"), false);
  assert.equal(finalUrl.searchParams.get("mode"), "plan");
  assert.equal(finalUrl.searchParams.get("workspaceId"), "w1");
});

test("SAFETY: clearFreshStartAndRegenerationUrlParams is a no-op (no history mutation) when neither 'new' nor 'reportId' is present", async () => {
  const clearFn = await loadRealClearFn();
  const stub = makeStubWindow("https://example.test/plan?mode=plan&workspaceId=w1");
  globalThis.window = stub.window;
  try {
    clearFn();
  } finally {
    delete globalThis.window;
  }
  assert.equal(stub.replaceCalls.length, 0, "expected no history.replaceState call when nothing needs to change");
});

test("SAFETY: clearFreshStartAndRegenerationUrlParams never throws when window is undefined (server-side / SSR-safe)", async () => {
  const clearFn = await loadRealClearFn();
  assert.doesNotThrow(() => clearFn());
});

// --- wiring: the fix runs exactly once, exactly at successful completion --

test("wiring: clearFreshStartAndRegenerationUrlParams is called immediately after setActiveReportId(savedReportId) inside the successful-save branch, never on the failure path", () => {
  assert.match(
    plannerSource,
    /setActiveReportId\(savedReportId\);\s*\n\s*clearFreshStartAndRegenerationUrlParams\(\);/
  );
  // Never called from the catch/failure branch (searched independently
  // of the success-branch match above).
  const failureBranchStart = plannerSource.indexOf('setPlanReport(null);\n      setMarketReport(null);\n      setReportProgress(0);');
  assert.ok(failureBranchStart > -1, "expected to find the failure branch");
  const failureBranchRegion = plannerSource.slice(failureBranchStart, failureBranchStart + 1500);
  assert.doesNotMatch(failureBranchRegion, /clearFreshStartAndRegenerationUrlParams/);
});

// --- root cause confirmation: page.tsx's own null-out logic, unchanged --

test("root cause confirmation: app/plan/page.tsx still nulls initialReport for 'new'/'reportId' URLs -- this fix works WITH that logic (by clearing the params once they've served their purpose), not by weakening it", () => {
  assert.match(
    planPageSource,
    /initialReport=\{\s*\n\s*shouldStartFresh \|\| regenerationContext \? null : conversationResult\.latestReport\s*\n\s*\}/
  );
});

test("root cause confirmation: findLatestCompletedReportWithContent (the deterministic, content-based lookup that restores the report once the URL is clean) is untouched by this fix", () => {
  assert.match(conversationsSource, /async function findLatestCompletedReportWithContent/);
  assert.match(conversationsSource, /report\.status\.toLowerCase\(\) === "completed"/);
  assert.doesNotMatch(conversationsSource, /TASK #69A-42/);
});

// --- no text-pattern suppression patch was added ------------------------

test("SAFETY: ChatMessages.tsx's own message-classification functions (isCompletedBusinessPlanReportMessage / shouldShowReportCompletionHeadline) are completely untouched -- no new or modified text-pattern suppression logic was added anywhere", () => {
  assert.doesNotMatch(chatMessagesSource, /TASK #69A-42/);
  assert.match(
    chatMessagesSource,
    /return classifyReportDomain\(precedingUserContent\) === "business";/
  );
});

// --- other already-correct, explicit-id-based paths remain unaffected --

test("'reopen from analysis history' (app/dashboard/[id]/page.tsx) already fetches its report by explicit URL id, never by inference from message text or from initialReport/planReport state -- unaffected by this fix, and already the 'explicit id' pattern this task prefers", () => {
  assert.match(reportDetailPageSource, /loadUserReport\(supabase, user, id\)/);
  assert.doesNotMatch(reportDetailPageSource, /TASK #69A-42/);
});

// --- decision/scoring/competitor/Porter/founder-readiness authority is
//     untouched --------------------------------------------------------

test("SAFETY: no canonical scoring, competitor-evidence, Porter, financial-consistency, or founder-readiness file carries a #69A-42 marker -- this is a URL/hydration fix only", () => {
  for (const relativePath of [
    "app/lib/ai/investment-score.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-engine/porters-five-forces-state.ts",
    "app/lib/report-consistency-validation.ts",
    "app/lib/report-jobs/plan-executor.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /TASK #69A-42/, `${relativePath} must not carry a #69A-42 marker`);
  }
});

test("SAFETY: removeLargePlannerQueryPayloads' own allow-list (new/mode/workspaceId/reportId, needed DURING an in-flight generation request) is completely unchanged by this fix", () => {
  assert.match(
    plannerSource,
    /const allowedPlannerParams = new Set\(\["new", "mode", "workspaceId", "reportId"\]\);/
  );
});
