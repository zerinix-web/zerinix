import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatPageSource = readFileSync("app/chat/page.tsx", "utf8");
const chatWorkspaceSource = readFileSync("components/AIChatWorkspace.tsx", "utf8");
const plannerSource = readFileSync("components/Planner.tsx", "utf8");
const chatRouteSource = readFileSync("app/api/chat/route.ts", "utf8");

test("AI Chat page loads owned report memory from reportId search param", () => {
  assert.match(chatPageSource, /searchParams\?: Promise/);
  assert.match(chatPageSource, /reportId\?: string/);
  assert.match(chatPageSource, /loadUserReport\(supabase, user, reportId\)/);
  assert.match(chatPageSource, /initialReportMemory=/);
});

test("AI Chat page can infer report memory from dashboard report referrer", () => {
  assert.match(chatPageSource, /headers/);
  assert.match(chatPageSource, /getReportIdFromReferrer/);
  assert.match(chatPageSource, /\^\\\/dashboard\\\/\(\[\^\/\?#\]\+\)\$/);
  assert.match(chatPageSource, /requestHeaders\.get\("referer"\)/);
  assert.match(chatPageSource, /conversationResult\.latestReport\?\.id/);
});

test("AI Chat client sends active report id with every chat request", () => {
  assert.match(chatWorkspaceSource, /initialReportMemory/);
  assert.match(chatWorkspaceSource, /ACTIVE_REPORT_ID_STORAGE_KEY/);
  assert.match(chatWorkspaceSource, /getReportIdFromLocation/);
  assert.match(chatWorkspaceSource, /getStoredActiveReportId/);
  assert.match(chatWorkspaceSource, /activeReportMemoryId/);
  assert.match(chatWorkspaceSource, /sessionStorage\.setItem\(\s*ACTIVE_REPORT_ID_STORAGE_KEY,\s*activeReportMemoryId\s*\)/);
  assert.match(chatWorkspaceSource, /reportId: activeReportMemoryId/);
  assert.match(plannerSource, /activeReportId/);
  assert.match(plannerSource, /getStoredActiveReportId/);
  assert.match(plannerSource, /sessionStorage\.setItem\(ACTIVE_REPORT_ID_STORAGE_KEY, activeReportId\)/);
  assert.match(plannerSource, /setActiveReportId\(savedReportId\)/);
  assert.match(plannerSource, /reportId: activeReportId/);
});

test("AI Chat API injects saved report memory before provider call", () => {
  assert.match(chatRouteSource, /loadUserReport/);
  assert.match(chatRouteSource, /buildReportMemoryContext/);
  assert.match(chatRouteSource, /A saved ZERINIX report is attached as authoritative report memory/);
  assert.match(chatRouteSource, /Prioritize the report memory over general model knowledge/);
  assert.match(chatRouteSource, /never say you assume/);
  assert.match(chatRouteSource, /report does not contain the requested information/);
  assert.match(chatRouteSource, /Saved ZERINIX report memory/);
  assert.match(chatRouteSource, /finalPromptLength/);
  assert.match(chatRouteSource, /reportMemoryLength/);
});

test("AI Chat cache is disabled when report memory is attached", () => {
  assert.match(chatRouteSource, /reportMemory: ReportMemoryContext \| null/);
  assert.match(chatRouteSource, /!input\.reportMemory/);
  assert.match(chatRouteSource, /report_memory_used/);
  assert.match(chatRouteSource, /report_id: reportMemory\?\.id \|\| null/);
});

test("AI Chat API returns a clear debug reason when report memory is missing", () => {
  assert.match(chatRouteSource, /isReportMemoryQuestion/);
  assert.match(chatRouteSource, /reportMemoryDebugReason/);
  assert.match(chatRouteSource, /No report is attached to this chat request/);
  assert.match(chatRouteSource, /Debug reason:/);
  assert.match(chatRouteSource, /reportMemoryAttached: false/);
});
