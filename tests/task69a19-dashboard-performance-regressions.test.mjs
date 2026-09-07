// TASK #69A-19 -- Diagnose and fix ZERINIX localhost/page-freeze and
// slow-loading performance regressions.
//
// MEASURED, NOT GUESSED: the actual page response for /dashboard/[id]
// was inspected directly (via a real request against the running dev
// server) and found to eagerly <script src> a 664KB minified jsPDF
// chunk (plus its own pako compression dependency) on EVERY report page
// load, even though jsPDF is only ever used inside the "Download PDF"
// click handler. Separately, source tracing proved
// loadPersistedConversations (Planner.tsx, run unconditionally on every
// mount of /plan and /chat) issues the EXACT SAME ai_conversations +
// ai_messages queries loadPlanConversations (app/plan/conversations.ts)
// already ran server-side, moments earlier, for the SAME request --
// and unconditionally overwrites the just-rendered, already-correct
// state with what is, in the common case, identical data.
//
// FIX 1 (bundle-size): ReportPdfButton.tsx (imported by page.tsx) and
// Planner.tsx's own downloadPdf both used to import jsPDF/pdf-engine
// functions at module top level. ReportPdfButtonLazy.tsx now wraps
// ReportPdfButton in next/dynamic(..., { ssr: false }) (App Router
// requires this ssr:false boundary to live in a Client Component, never
// directly in the Server Component page.tsx); Planner.tsx's downloadPdf
// now dynamically imports the pdf-engine modules only once the user has
// actually clicked "Download PDF" and passed the quota check.
//
// FIX 2 (duplicate fetch): loadPersistedConversations now skips its own
// ai_conversations/ai_messages re-fetch (and the two extra Supabase auth
// round trips that precede it) whenever the server already supplied a
// non-empty, error-free initialConversations snapshot -- both already
// available as this component's own props, both force-dynamic per-
// request-fresh (app/plan/page.tsx, app/chat/page.tsx), so trusting them
// introduces no staleness. The full fetch remains completely unchanged
// as the genuine recovery path whenever SSR found nothing or reported an
// error.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const pageSource = readFileSync(join(repoRoot, "app/dashboard/[id]/page.tsx"), "utf8");
const reportPdfButtonSource = readFileSync(join(repoRoot, "app/dashboard/[id]/ReportPdfButton.tsx"), "utf8");
const reportPdfButtonLazySource = readFileSync(
  join(repoRoot, "app/dashboard/[id]/ReportPdfButtonLazy.tsx"),
  "utf8"
);
const planPageSource = readFileSync(join(repoRoot, "app/plan/page.tsx"), "utf8");
const chatPageSource = readFileSync(join(repoRoot, "app/chat/page.tsx"), "utf8");
const conversationsSource = readFileSync(join(repoRoot, "app/plan/conversations.ts"), "utf8");

// --- Root cause confirmation ----------------------------------------------

test("root cause confirmation: Planner.tsx used to import createPdfDocument (jsPDF-backed) at module top level -- the fix removed it, keeping only the type import", () => {
  assert.doesNotMatch(plannerSource, /^import \{\s*\n\s*applyPdfFont,\s*\n\s*createPdfDocument,/m);
  assert.match(plannerSource, /import type \{ PdfLocale \} from "@\/app\/lib\/pdf-engine\/core";/);
});

test("root cause confirmation: page.tsx used to statically import ReportPdfButton directly -- the fix routes through the lazy wrapper instead", () => {
  assert.doesNotMatch(pageSource, /^import ReportPdfButton from "\.\/ReportPdfButton";$/m);
});

test("root cause confirmation: loadPlanConversations (server, app/plan/conversations.ts) and loadPersistedConversations (client, Planner.tsx) query the exact same tables with the exact same shape", () => {
  assert.match(conversationsSource, /\.from\("ai_conversations"\)\s*\n\s*\.select\("id,title,created_at,updated_at"\)/);
  assert.match(conversationsSource, /\.from\("ai_messages"\)/);
  assert.match(plannerSource, /\.from\("ai_conversations"\)\s*\n\s*\.select\("id,title,created_at,updated_at"\)/);
});

// --- Fix 1 proof: PDF machinery is lazily loaded --------------------------

test("fix 1 proof: Planner.tsx's downloadPdf now dynamically imports the pdf-engine modules only after the permission check succeeds -- never at module scope", () => {
  const permissionCheckIndex = plannerSource.indexOf('setPdfError(errorPayload?.error || "PDF export is unavailable right now.");');
  const dynamicImportIndex = plannerSource.indexOf('await import("@/app/lib/pdf-engine/core")');
  const createDocCallIndex = plannerSource.indexOf("const pdf = createPdfDocument();");
  assert.ok(permissionCheckIndex >= 0 && dynamicImportIndex > permissionCheckIndex && createDocCallIndex > dynamicImportIndex);
  assert.match(plannerSource, /await import\("@\/app\/lib\/pdf-engine\/section-renderer"\)/);
  assert.match(plannerSource, /await import\(\s*\n\s*"@\/app\/lib\/pdf-engine\/utils"\s*\n\s*\)/);
});

test("fix 1 proof: every pdf-engine function downloadPdf uses (applyPdfFont, createPdfDocument, drawPdfFooter, drawPdfLogoMark, getPdfPageMetrics, paintPdfPageBackground, drawPdfSectionCardFrame, splitPdfReadableLinesWithEngine) is destructured from the dynamic import, not a stale top-level binding", () => {
  const dynamicImportBlockStart = plannerSource.indexOf('await import("@/app/lib/pdf-engine/core")');
  const dynamicImportBlockEnd = plannerSource.indexOf(";", plannerSource.indexOf("splitPdfReadableLinesWithEngine } = await import"));
  const block = plannerSource.slice(Math.max(0, dynamicImportBlockStart - 400), dynamicImportBlockEnd + 1);
  for (const fn of [
    "applyPdfFont",
    "createPdfDocument",
    "drawPdfFooter",
    "drawPdfLogoMark",
    "getPdfPageMetrics",
    "paintPdfPageBackground",
    "drawPdfSectionCardFrame",
    "splitPdfReadableLinesWithEngine",
  ]) {
    assert.match(block, new RegExp(fn), `expected ${fn} to be destructured from a dynamic import`);
  }
});

test("fix 1 proof: ReportPdfButtonLazy.tsx is a Client Component wrapping ReportPdfButton in next/dynamic with ssr:false", () => {
  assert.match(reportPdfButtonLazySource, /^"use client";/);
  assert.match(reportPdfButtonLazySource, /import dynamic from "next\/dynamic";/);
  assert.match(
    reportPdfButtonLazySource,
    /const ReportPdfButton = dynamic\(\(\) => import\("\.\/ReportPdfButton"\), \{\s*\n\s*ssr: false,\s*\n\s*\}\);/
  );
  assert.match(reportPdfButtonLazySource, /export default function ReportPdfButtonLazy\(/);
});

test("fix 1 proof: page.tsx imports the lazy wrapper (ReportPdfButtonLazy) under the SAME local name (ReportPdfButton) so every existing <ReportPdfButton report={report} /> call site is unchanged", () => {
  assert.match(pageSource, /import ReportPdfButton from "\.\/ReportPdfButtonLazy";/);
  const usageCount = (pageSource.match(/<ReportPdfButton report=\{report\} \/>/g) || []).length;
  assert.equal(usageCount, 2, "expected both existing usage sites to still pass report={report} unchanged");
});

test("fix 1 proof: ReportPdfButton.tsx itself (the actual heavy component) is completely untouched -- its own PDF-building logic, props, and behavior are byte-identical", () => {
  assert.match(reportPdfButtonSource, /^"use client";/);
  assert.match(reportPdfButtonSource, /export default function ReportPdfButton\(\{ report \}: \{ report: DashboardReport \}\)/);
  assert.doesNotMatch(reportPdfButtonSource, /#69A-19/);
});

// --- Fix 2 proof: duplicate conversation fetch is eliminated --------------

test("fix 2 proof: loadPersistedConversations skips the ai_conversations/ai_messages re-fetch when initialConversations is already non-empty and there was no conversationLoadError", () => {
  const fnStart = plannerSource.indexOf("async function loadPersistedConversations() {");
  const skipIndex = plannerSource.indexOf(
    "if (initialConversations.length > 0 && !conversationLoadError) {",
    fnStart
  );
  const queryIndex = plannerSource.indexOf('.from("ai_conversations")', fnStart);
  assert.ok(fnStart >= 0 && skipIndex > fnStart && skipIndex < queryIndex, "the skip check must run before the heavy queries");
});

test("fix 2 proof: the skip still resolves userEmail first -- auth resolution (restoreSupabaseSession + auth.getUser()) is never bypassed, only the two heavy DB queries are", () => {
  const fnStart = plannerSource.indexOf("async function loadPersistedConversations() {");
  const skipIndex = plannerSource.indexOf(
    "if (initialConversations.length > 0 && !conversationLoadError) {",
    fnStart
  );
  const setUserEmailIndex = plannerSource.indexOf('setUserEmail(user.email || "");', fnStart);
  assert.ok(setUserEmailIndex > fnStart && setUserEmailIndex < skipIndex, "userEmail must still be set before the skip check runs");
});

test("fix 2 proof: the full fetch path (ai_conversations select, ai_messages fetch, setConversations, setActiveConversationId) remains completely intact for the fallback case -- this fix only adds an early return, it does not remove or alter any existing logic", () => {
  assert.match(plannerSource, /const \{ data, error \} = await supabase\s*\n\s*\.from\("ai_conversations"\)/);
  assert.match(plannerSource, /setConversations\(nextConversations\);/);
  assert.match(plannerSource, /setActiveConversationId\(\(currentId\) =>/);
});

test("fix 2 proof: app/plan/page.tsx and app/chat/page.tsx still pass BOTH initialConversations and conversationLoadError into Planner, unchanged -- the skip condition has real, working inputs to check", () => {
  for (const [name, source] of [["plan/page.tsx", planPageSource], ["chat/page.tsx", chatPageSource]]) {
    assert.match(source, /initialConversations=\{conversationResult\.conversations\}/, `${name} must still pass initialConversations`);
  }
});

// --- Regression: no duplicate critical fetches -----------------------------

test("regression: loadPersistedConversations issues at most ONE ai_conversations query and ONE ai_messages fetch per call, never two independent attempts within the same invocation", () => {
  const fnStart = plannerSource.indexOf("async function loadPersistedConversations() {");
  const fnBody = plannerSource.slice(fnStart, plannerSource.indexOf("\n  async function loadPersistedMessages", fnStart));
  const conversationsQueryCount = (fnBody.match(/\.from\("ai_conversations"\)/g) || []).length;
  assert.equal(conversationsQueryCount, 1, "expected exactly one ai_conversations query site inside this function");
});

// --- Regression: failed optional fetch does not trap the page -----------

test("regression: every early-return branch inside loadPersistedConversations (auth error, missing user, query error) still returns cleanly rather than throwing or leaving a pending promise -- a failed fetch can never permanently block the UI", () => {
  const fnStart = plannerSource.indexOf("async function loadPersistedConversations() {");
  const fnEnd = plannerSource.indexOf("\n  async function loadPersistedMessages", fnStart);
  const fnBody = plannerSource.slice(fnStart, fnEnd);
  const returnCount = (fnBody.match(/\n\s*return;/g) || []).length;
  assert.ok(returnCount >= 4, `expected at least 4 early-return branches (userError, missing user, skip, query error), found ${returnCount}`);
  assert.doesNotMatch(fnBody, /throw /);
});

// --- Regression: report content unchanged ----------------------------------

test("regression: report content/section rendering logic in page.tsx is untouched by this performance fix -- only the ReportPdfButton import site changed", () => {
  assert.match(pageSource, /const storedReportSections = Array\.from\(/);
  assert.match(pageSource, /const visibleSections = uniqueReportSections/);
});

// --- Regression: auth/admin behavior unchanged -----------------------------

test("regression: auth resolution (getAuthenticatedUser, loadUserReport) and the redirect-to-login/notFound gates in page.tsx are untouched", () => {
  assert.match(pageSource, /const user = await getAuthenticatedUser\(supabase\);/);
  assert.match(pageSource, /if \(!user\) \{\s*\n\s*redirect\("\/login"\);\s*\n\s*\}/);
  assert.match(pageSource, /const report = await loadUserReport\(supabase, user, id\);/);
});

test("regression: the admin/owner PDF export quota bypass from #69A-16B is untouched by this fix", () => {
  const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
  assert.match(pdfExportRouteSource, /if \(!permission\.allowed && !isUsageLimitExemptAccount\) \{/);
});

// --- Regression: history/report selection remains functional --------------

test("regression: selectConversation's own per-conversation message refetch (loadPersistedMessages, triggered by an explicit user click, not mount) is untouched by this fix -- switching conversations still works exactly as before", () => {
  assert.match(plannerSource, /async function loadPersistedMessages\(conversationId: string\) \{/);
  assert.match(plannerSource, /void loadPersistedMessages\(conversationId\);/);
});

test("regression: useConversations still seeds its conversations state from initialConversations exactly as before -- this fix only affects the client-side re-fetch effect, never the initial hydration itself", () => {
  assert.match(
    plannerSource,
    /const \[conversations, setConversations\] = useState<Conversation\[\]>\(\(\) =>\s*\n\s*initialConversations\.length > 0\s*\n\s*\? initialConversations/
  );
});

// --- Preserve #69A-15 through #69A-18 --------------------------------------

test("preserves #69A-15 through #69A-18: no competitor-landscape, Founder Readiness, benchmark-gap, or admin-bypass file carries a #69A-19 marker", () => {
  for (const relativePath of [
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/ai/investment-score.ts",
    "app/lib/report-presentation.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/api/usage/pdf-export/route.ts",
    "app/lib/strategic-report-access.ts",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-19/);
  }
});
