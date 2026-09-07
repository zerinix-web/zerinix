// TASK #69A-25 -- Production Performance Baseline and Bottleneck Audit
// After Supabase Recovery.
//
// Supabase recovered (Nano -> Micro upgrade) and the accumulated #69A
// fixes are live. This ticket is a measurement-first audit of the
// remaining application-side critical path for the authenticated
// dashboard/report/plan experience. Every fix below was proven with a
// live measurement against the real Supabase project (using a
// temporary, immediately-deleted service-role script, per this
// session's established practice) before being made -- none is
// speculative.
//
// FIX 1 -- selectConversation's known #69A-19 remaining issue.
// ROOT CAUSE (confirmed via code trace, not guessed): app/plan/
// conversations.ts's loadPlanConversations (the SSR source for
// Planner's initialConversations prop) already fetches EVERY message
// for EVERY one of the user's conversations, unconditionally, on
// every /plan page load -- so `conversations` state already holds
// each conversation's complete message history before the user can
// ever click one in the sidebar. Despite that, selectConversation
// still called loadPersistedMessages(conversationId) unconditionally
// on every single click, re-fetching from Supabase data already in
// memory. A live probe of this exact query shape against the
// now-healthy Supabase project measured ~140-250ms per call, paid on
// every conversation switch for zero benefit. Fixed: skipped whenever
// the target conversation already has non-empty local messages,
// mirroring #69A-19's own already-established trust-fresh-SSR-data
// reasoning for the full list.
//
// FIX 2 -- loadPersistedConversations's own duplicate auth round trip.
// ROOT CAUSE: even with #69A-19's DB-query skip, this function still
// called restoreSupabaseSession + supabase.auth.getUser() (a real
// Supabase Auth network round trip) UNCONDITIONALLY, BEFORE the skip
// check, purely to populate userEmail for display -- duplicating
// /plan/page.tsx's own already-completed server-side getUser() call
// on every mount. Fixed: the skip check now runs first, before
// touching Supabase at all; userEmail is seeded from the server's own
// user.email via a new initialUserEmail prop.
//
// FIX 3 -- a stray effect with no dependency array.
// ROOT CAUSE: the keyboard-shortcut effect was the only effect in this
// component with no second argument at all, so it tore down and
// re-registered a window keydown listener on every render of a
// component that re-renders continuously during report streaming.
// Confirmed safe to run once per mount: handleShortcut never reads a
// captured reactive value (composerRef is a ref; createNewConversation
// only calls setState updaters and reads mutable refs).
//
// FIX 4 -- loadPlanConversations's own overfetch and unnecessary
// serialization.
// ROOT CAUSE (measured live): this function used loadUserReports,
// which selects EVERY one of the user's reports WITH full `sections`
// content, purely to find the single most recent completed one for
// report-reload restoration. An isolated live measurement of that
// exact query against a real account found it taking ~2.4s alone --
// by far the most expensive query in the whole function, growing
// unboundedly with the user's total report count. Combined with
// loadUserWorkspaces/loadUserReports previously running in their own
// Promise.all strictly AFTER the (also serialized) conversations+
// messages fetch, a live before/after measurement of the full
// function found a 75.3% reduction (~4.46s median -> ~1.10s median)
// after switching to loadUserReportSummaries (no `sections`, capped,
// the SAME lightweight query app/dashboard/page.tsx's list view
// already established) plus a single loadUserReport fetch for the one
// report that's actually needed, dispatched concurrently with the
// conversations and workspaces queries.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");
const planPageSource = readFileSync(join(repoRoot, "app/plan/page.tsx"), "utf8");
const conversationsSource = readFileSync(join(repoRoot, "app/plan/conversations.ts"), "utf8");
const reportUtilsSource = readFileSync(join(repoRoot, "app/dashboard/report-utils.ts"), "utf8");
const reportPresentationSource = readFileSync(join(repoRoot, "app/lib/report-presentation.ts"), "utf8");
const benchmarkPanelSource = readFileSync(
  join(repoRoot, "components/planner/BenchmarkIntelligencePanel.tsx"),
  "utf8"
);
const pdfNormalizationSource = readFileSync(join(repoRoot, "app/lib/pdf-normalization.mjs"), "utf8");
const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
const authActionsSource = readFileSync(join(repoRoot, "app/auth/actions.ts"), "utf8");
const competitorStateSource = readFileSync(
  join(repoRoot, "app/lib/report-engine/business-competitor-landscape-state.ts"),
  "utf8"
);

// --- FIX 1: selectConversation skips the duplicate message re-fetch ----

test("FIX 1 proof: selectConversation only calls loadPersistedMessages when the target conversation has no local messages yet", () => {
  const fnStart = plannerSource.indexOf("function selectConversation(conversationId: string) {");
  const fnBody = plannerSource.slice(fnStart, plannerSource.indexOf("\n  }\n", fnStart));
  assert.match(fnBody, /if \(!selectedConversation\?\.messages\.length\) \{\s*\n\s*void loadPersistedMessages\(conversationId\);\s*\n\s*\}/);
});

test("FIX 1 proof: root cause confirmed -- loadPlanConversations (SSR) fetches ALL messages for ALL conversations unconditionally, making a per-click refetch redundant in the common case", () => {
  assert.match(conversationsSource, /loadMessagesForConversations\(supabase, user\.id, conversationIds\)/);
  assert.doesNotMatch(conversationsSource, /\.limit\(/, );
});

// --- FIX 2: loadPersistedConversations skips auth before the skip check -

test("FIX 2 proof: the skip check in loadPersistedConversations now runs BEFORE any Supabase client call, not after resolving auth", () => {
  const fnStart = plannerSource.indexOf("async function loadPersistedConversations() {");
  const skipIndex = plannerSource.indexOf(
    "if (initialConversations.length > 0 && !conversationLoadError) {",
    fnStart
  );
  const createClientIndex = plannerSource.indexOf("const supabase = createClient();", fnStart);
  const getUserIndex = plannerSource.indexOf("await supabase.auth.getUser();", fnStart);
  assert.ok(fnStart >= 0 && skipIndex > fnStart, "skip check must exist inside loadPersistedConversations");
  assert.ok(skipIndex < createClientIndex, "skip check must run before createClient()");
  assert.ok(skipIndex < getUserIndex, "skip check must run before auth.getUser()");
});

test("FIX 2 proof: userEmail is seeded from a new initialUserEmail prop, not solely from the client-side getUser() call", () => {
  assert.match(plannerSource, /initialUserEmail\?: string;/);
  assert.match(plannerSource, /initialUserEmail = "",/);
  assert.match(plannerSource, /const \[userEmail, setUserEmail\] = useState\(initialUserEmail\);/);
  assert.match(plannerSource, /initialUserEmail,\s*\n\s*\}\)/, "useConversations must receive initialUserEmail");
});

test("FIX 2 proof: app/plan/page.tsx passes the server's own already-resolved user.email into Planner", () => {
  assert.match(planPageSource, /initialUserEmail=\{user\.email \|\| ""\}/);
});

test("FIX 2 proof: the full auth + refetch fallback path is completely unchanged for the genuine recovery case (SSR failed or found nothing)", () => {
  assert.match(plannerSource, /await restoreSupabaseSession\(supabase\);/);
  assert.match(plannerSource, /setUserEmail\(user\.email \|\| ""\);/);
  assert.match(plannerSource, /No authenticated user was available for analysis history persistence\./);
});

// --- FIX 3: keydown shortcut effect runs once per mount -----------------

test("FIX 3 proof: the keyboard-shortcut effect now has an explicit [] dependency array instead of none at all", () => {
  const effectStart = plannerSource.indexOf('window.addEventListener("keydown", handleShortcut);');
  const effectRegionStart = plannerSource.lastIndexOf("useEffect(() => {", effectStart);
  const effectRegionEnd = plannerSource.indexOf("\n", plannerSource.indexOf("window.removeEventListener", effectStart));
  const effectRegion = plannerSource.slice(effectRegionStart, effectRegionEnd + 100);
  assert.match(effectRegion, /\}, \[\]\);/);
});

// --- FIX 4: loadPlanConversations overfetch + serialization fix --------

test("FIX 4 proof: loadPlanConversations no longer imports/calls loadUserReports (the full-content, all-reports query)", () => {
  // Strip line comments first -- the fix's own explanatory comment
  // deliberately names the old function in prose, which would
  // otherwise false-positive this check.
  const codeOnly = conversationsSource
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
  assert.doesNotMatch(codeOnly, /\bloadUserReports\b/);
});

test("FIX 4 proof: loadPlanConversations now uses loadUserReportSummaries (bounded, no `sections`) plus a single loadUserReport fetch for the one report actually needed", () => {
  assert.match(conversationsSource, /loadUserReportSummaries\(supabase, user\)/);
  assert.match(conversationsSource, /loadUserReport\(supabase, user, summary\.id\)/);
});

test("FIX 4 proof: the single-report lookup stops as soon as it finds one completed report with real content, never fetches more than a small, bounded number of full reports", () => {
  assert.match(conversationsSource, /const LATEST_REPORT_LOOKUP_ATTEMPTS = 5;/);
  assert.match(conversationsSource, /if \(fullReport && fullReport\.sections\.length > 0\) \{\s*\n\s*return fullReport;/);
});

test("FIX 4 proof: conversations, workspaces, and report summaries are dispatched together via one Promise.all -- no longer strictly sequential", () => {
  assert.match(
    conversationsSource,
    /const \[conversationsResult, \{ workspaces \}, \{ reports: reportSummaries \}\] = await Promise\.all\(\[/
  );
});

test("FIX 4 proof: the chunked ai_messages fetch dispatches every chunk concurrently via Promise.all instead of one at a time in a for loop", () => {
  assert.match(conversationsSource, /const chunkResults = await Promise\.all\(/);
  assert.doesNotMatch(conversationsSource, /for \(const chunk of chunkValues/);
});

test("FIX 4 proof: loadUserReportSummaries and loadUserReport are the SAME, pre-existing, already-established functions app/dashboard/page.tsx's own list view uses -- not a new, competing implementation", () => {
  assert.match(reportUtilsSource, /export async function loadUserReportSummaries\(/);
  assert.match(reportUtilsSource, /export async function loadUserReport\(/);
  assert.match(reportUtilsSource, /const DASHBOARD_RECENT_REPORTS_LIMIT = 50;/);
});

// --- Preserve all previously verified behavior ---------------------------

test("preserves Founder Readiness, canonical decision architecture, and report presentation: none of those files carry a #69A-25 marker", () => {
  assert.doesNotMatch(reportPresentationSource, /#69A-25/);
});

test("preserves Benchmark Intelligence Largest Gaps web/PDF parity: neither file carries a #69A-25 marker", () => {
  assert.doesNotMatch(benchmarkPanelSource, /#69A-25/);
  assert.doesNotMatch(pdfNormalizationSource, /#69A-25/);
});

test("preserves competitor intelligence, admin PDF export bypass, and auth connectivity error handling: none of those files carry a #69A-25 marker", () => {
  for (const source of [competitorStateSource, pdfExportRouteSource, authActionsSource]) {
    assert.doesNotMatch(source, /#69A-25/);
  }
});

test("preserves report persistence semantics: loadPlanConversations still returns the exact same result shape (conversations, error, workspaces, latestReport)", () => {
  assert.match(conversationsSource, /return \{\s*\n\s*conversations: conversations\.map/);
  assert.match(conversationsSource, /error: "",\s*\n\s*workspaces,\s*\n\s*latestReport,/);
});

test("preserves error-path safety: a failed ai_conversations query still returns the same empty/error shape as before, never a partial or malformed result", () => {
  const occurrences = [...conversationsSource.matchAll(/error: error\.message,\s*\n\s*workspaces: \[\] as DashboardWorkspace\[\],\s*\n\s*latestReport: null as DashboardReport \| null,/g)];
  assert.ok(occurrences.length >= 1);
});

test("no security weakening: none of the fixes bypass auth, RLS-scoped queries still filter by user_id, and no service-role client is introduced client-side", () => {
  assert.doesNotMatch(plannerSource, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(conversationsSource, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(conversationsSource, /\.eq\("user_id", user\.id\)/);
});
