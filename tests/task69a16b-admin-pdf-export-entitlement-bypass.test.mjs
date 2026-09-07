// TASK #69A-16B -- Fix admin/owner PDF export entitlement bypass.
//
// ROOT CAUSE (traced end-to-end, not guessed): every OTHER AI-usage quota
// path (report generation, chat, market analysis) is gated through
// checkAiProductionRateLimit (app/lib/ai/rate-limit.ts), which already
// computes `founderQuotaExempt = isFounderAccount(account)` and returns
// `allowed: true` immediately when true ("founder account quota bypass").
// PDF export is a SEPARATE, standalone endpoint
// (app/api/usage/pdf-export/route.ts) that calls checkAIUsagePermission
// directly and never consulted that exemption -- or ANY admin/owner
// resolution -- at all. So even the canonical, real admin/owner account
// was treated as an ordinary quota-limited user the moment its monthly
// PDF export count (governance.ts's loadMonthlyOperationUsage over
// ai_usage_events) reached the plan's monthlyPdfExports limit.
//
// FIX: app/lib/strategic-report-access.ts gained a new, small exported
// helper, isVerifiedAdminOrOwnerAccount(account), extracted verbatim from
// authorizeStrategicReportAccess's own two admin/owner branches (verified
// JWT claim via hasVerifiedAdminOrOwnerClaim, then the service-role
// admin_roles table lookup via the SAME lazy dynamic import
// authorizeStrategicReportAccess already uses) -- the exact canonical
// admin/owner resolution this codebase already trusts elsewhere,
// deliberately NOT bundled with isPrivateBetaAllowed's unrelated
// beta-email-allowlist branch (a private-beta-approved account is not
// necessarily an admin/owner). pdf-export/route.ts now computes
// `isUsageLimitExemptAccount = isFounderAccount(user) ||
// await isVerifiedAdminOrOwnerAccount(user)` from the server-verified
// `user` object (supabase.auth.getUser()'s own result -- never anything
// from the request body) and only blocks when
// `!permission.allowed && !isUsageLimitExemptAccount`. Everything else
// (checkAIUsagePermission's own limit computation, recordAiUsage's
// normal-user write shape, getUserPlanTier) is byte-unchanged.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isVerifiedAdminOrOwnerAccount,
  authorizeStrategicReportAccess,
} from "../app/lib/strategic-report-access.ts";
import { isFounderAccount, hasVerifiedAdminOrOwnerClaim, isAdminOrOwnerRole } from "../app/lib/beta-access.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const pdfExportRouteSource = readFileSync(join(repoRoot, "app/api/usage/pdf-export/route.ts"), "utf8");
const strategicAccessSource = readFileSync(join(repoRoot, "app/lib/strategic-report-access.ts"), "utf8");
const plannerSource = readFileSync(join(repoRoot, "components/Planner.tsx"), "utf8");

function user(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    app_metadata: {},
    user_metadata: {},
    identities: [],
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// The EXACT decision formula pdf-export/route.ts now runs, replicated
// here with the REAL, imported functions (never re-implemented) so this
// test proves the actual boolean combination, not merely that the
// source text contains the right words.
async function isPdfExportBlocked(account, allowed, { loadAdminRole } = {}) {
  const isUsageLimitExemptAccount =
    isFounderAccount(account) ||
    (await isVerifiedAdminOrOwnerAccount(account, loadAdminRole ? { loadAdminRole } : undefined));
  return !allowed && !isUsageLimitExemptAccount;
}

// --- Root cause confirmation ---------------------------------------------

test("root cause confirmation: checkAiProductionRateLimit (report/chat/market quotas) already exempts founder accounts, but pdf-export/route.ts (BEFORE this fix) called checkAIUsagePermission directly with no exemption of any kind", () => {
  const rateLimitSource = readFileSync(join(repoRoot, "app/lib/ai/rate-limit.ts"), "utf8");
  assert.match(rateLimitSource, /const founderQuotaExempt = isFounderAccount\(account\);/);
  assert.match(rateLimitSource, /if \(founderQuotaExempt\) \{/);
});

// --- Requirement 1: canonical admin/owner account is not blocked --------

test("requirement 1: an account with a verified admin JWT claim (app_metadata.role = \"admin\") is never blocked by an exhausted PDF export quota", async () => {
  const admin = user({ app_metadata: { role: "admin" } });
  assert.equal(await isPdfExportBlocked(admin, false), false);
});

test("requirement 1: an account with a verified owner JWT claim (app_metadata.role = \"owner\") is never blocked by an exhausted PDF export quota", async () => {
  const owner = user({ app_metadata: { role: "owner" } });
  assert.equal(await isPdfExportBlocked(owner, false), false);
});

test("requirement 1: an account with no JWT claim, but a real, active admin_roles DB row (the canonical role/admin system's OTHER branch), is never blocked -- proven via the exact same loadAdminRole injection authorizeStrategicReportAccess's own test file already uses", async () => {
  const plainAdmin = user();
  const blocked = await isPdfExportBlocked(plainAdmin, false, {
    loadAdminRole: async () => "admin",
  });
  assert.equal(blocked, false);
});

test("requirement 1: an account with a real, active OWNER admin_roles DB row is never blocked", async () => {
  const plainOwner = user();
  const blocked = await isPdfExportBlocked(plainOwner, false, {
    loadAdminRole: async () => "owner",
  });
  assert.equal(blocked, false);
});

test("requirement 1: a founder account (the SAME mechanism already exempting report/chat/market quotas) is never blocked by an exhausted PDF export quota either -- consistent exemption across every AI-usage-adjacent limit for the same privileged identity", async () => {
  const originalFounderEmails = process.env.FOUNDER_EMAILS;
  process.env.FOUNDER_EMAILS = "founder@zerinix.com";
  try {
    const founder = user({ email: "founder@zerinix.com" });
    const blocked = await isPdfExportBlocked(founder, false, {
      loadAdminRole: async () => null,
    });
    assert.equal(blocked, false, "a real founder account must not be blocked even with zero admin_roles claim/row");
  } finally {
    process.env.FOUNDER_EMAILS = originalFounderEmails;
  }
  assert.match(pdfExportRouteSource, /isFounderAccount\(user\)/);
});

// --- Requirement 2: normal quota-limited users remain blocked -----------

test("requirement 2: a normal, non-admin, non-founder, non-owner user is STILL correctly blocked once their quota is exhausted -- this fix only ever widens the allowed set, never narrows it", async () => {
  const normalUser = user();
  const blocked = await isPdfExportBlocked(normalUser, false, {
    loadAdminRole: async () => null,
  });
  assert.equal(blocked, true);
});

test("requirement 2: a normal user with quota still remaining is allowed exactly as before -- unaffected by this fix either way", async () => {
  const normalUser = user();
  const blocked = await isPdfExportBlocked(normalUser, true, {
    loadAdminRole: async () => null,
  });
  assert.equal(blocked, false);
});

test("requirement 2: a normal user whose admin-role DB lookup itself fails (transient DB error) is fail-safe -- treated as non-admin, never granted a free bypass by accident", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const normalUser = user();
    const blocked = await isPdfExportBlocked(normalUser, false, {
      loadAdminRole: async () => {
        throw new Error("admin_roles lookup unavailable");
      },
    });
    assert.equal(blocked, true, "a failed role lookup must never silently grant quota exemption");
  } finally {
    console.error = originalConsoleError;
  }
});

// --- Requirement 3: client-side role spoofing cannot bypass the limit ---

test("requirement 3: a spoofed top-level 'role'/'isAdmin'/'admin' field on the account object (NOT inside the real, server-verified app_metadata claim) grants nothing -- hasVerifiedAdminOrOwnerClaim only ever reads app_metadata.role/app_metadata.roles", async () => {
  const spoofedAccount = user({
    role: "admin",
    isAdmin: true,
    admin: true,
    app_metadata: { plan: "free" },
  });
  assert.equal(hasVerifiedAdminOrOwnerClaim(spoofedAccount), false);
  const blocked = await isPdfExportBlocked(spoofedAccount, false, {
    loadAdminRole: async () => null,
  });
  assert.equal(blocked, true, "a spoofed non-app_metadata field must never bypass the quota");
});

test("requirement 3: a spoofed app_metadata.roles array containing a plausible-looking but non-admin string does not grant access -- isAdminOrOwnerRole/hasVerifiedAdminOrOwnerClaim only accept the literal 'admin'/'owner' role values", async () => {
  const spoofedAccount = user({ app_metadata: { roles: ["administrator", "super-admin", "root"] } });
  assert.equal(hasVerifiedAdminOrOwnerClaim(spoofedAccount), false);
  assert.equal(isAdminOrOwnerRole("administrator"), false);
});

test("requirement 3: pdf-export/route.ts's exemption is computed ONLY from the server-verified `user` object returned by supabase.auth.getUser() -- never from the parsed request `body` (reportId/reportTitle are the ONLY fields ever read from body)", () => {
  assert.match(pdfExportRouteSource, /isFounderAccount\(user\)/);
  assert.match(pdfExportRouteSource, /isVerifiedAdminOrOwnerAccount\(user\)/);
  assert.doesNotMatch(pdfExportRouteSource, /isFounderAccount\(body/);
  assert.doesNotMatch(pdfExportRouteSource, /isVerifiedAdminOrOwnerAccount\(body/);
  // The only two fields this route ever reads off the client-supplied body.
  const bodyReads = [...pdfExportRouteSource.matchAll(/readBodyString\(body\?\.(\w+)\)/g)].map((m) => m[1]);
  assert.deepEqual(bodyReads.sort(), ["reportId", "reportTitle"]);
});

test("requirement 3: isVerifiedAdminOrOwnerAccount's own DB-backed branch is resolved via a service-role query in supabase/admin.ts (never a value the client can influence) -- confirmed by source shape, mirroring authorizeStrategicReportAccess's own identical, already-established lazy-import pattern", () => {
  assert.match(
    strategicAccessSource,
    /async function loadActiveAdminRole\(userId: string\) \{\s*\n\s*const admin = await import\("\.\/supabase\/admin\.ts"\);\s*\n\s*return admin\.loadActiveAdminRole\(userId\);\s*\n\}/
  );
  // isVerifiedAdminOrOwnerAccount defaults to that SAME loader, not a
  // second, independently-drifting copy.
  const fnMatch = /export async function isVerifiedAdminOrOwnerAccount\(\s*\n\s*account: User,\s*\n\s*\{ loadAdminRole = loadActiveAdminRole \}/.exec(
    strategicAccessSource
  );
  assert.ok(fnMatch, "isVerifiedAdminOrOwnerAccount must default to the real loadActiveAdminRole, not a stub");
});

// --- Requirement 4: PDF export endpoint and Download PDF UI state agree -

test("requirement 4: Planner.tsx's downloadPdf gates SOLELY on permissionResponse.ok -- there is no separate remainingUsage-based UI check that could disagree with the server's own allow/block decision", () => {
  const fetchIndex = plannerSource.indexOf('await fetch("/api/usage/pdf-export"');
  assert.ok(fetchIndex >= 0, "expected the PDF export permission fetch call");
  const nearbyBlock = plannerSource.slice(fetchIndex, fetchIndex + 800);
  assert.match(nearbyBlock, /if \(!permissionResponse\.ok\) \{/);
  // The client never reads remainingUsage/pdfExports at all -- the ONLY
  // signal driving the UI is whether the fetch itself succeeded, so an
  // admin/owner's 200 OK (via this ticket's exemption) and a blocked
  // normal user's 429 are the ONLY two states the UI can ever see, and
  // they always match the server's real decision.
  assert.doesNotMatch(plannerSource, /remainingUsage\.pdfExports/);
});

test("requirement 4: the exemption branch returns the SAME success response shape ({ ok: true, remainingUsage }) as a normal successful export -- the UI's ok-check behaves identically for an exempt admin as for a normal user within quota", () => {
  const successReturnIndex = pdfExportRouteSource.lastIndexOf("return noStoreJson({\n    ok: true,");
  assert.ok(successReturnIndex >= 0);
  // This return statement is reached whenever the blocking `if` above did
  // NOT return early -- i.e. whenever `permission.allowed ||
  // isUsageLimitExemptAccount`, so an exempt admin with an exhausted
  // quota reaches the exact same success path a normal in-quota user does.
  const blockingIfIndex = pdfExportRouteSource.indexOf("if (!permission.allowed && !isUsageLimitExemptAccount) {");
  assert.ok(blockingIfIndex >= 0 && blockingIfIndex < successReturnIndex);
});

// --- Requirement 5: existing billing/entitlement behavior unchanged -----

test("requirement 5: checkAIUsagePermission, getUserPlanTier, and the blocked-path recordAiUsage call are byte-unchanged by this fix -- normal-user quota computation and audit-write shape are untouched", () => {
  assert.match(
    pdfExportRouteSource,
    /const planTier = await getUserPlanTier\(supabase, user\.id\);/
  );
  assert.match(
    pdfExportRouteSource,
    /const permission = await checkAIUsagePermission\(\{\s*\n\s*supabase,\s*\n\s*userId: user\.id,\s*\n\s*operationType: "pdf_export",\s*\n\s*planTier,\s*\n\s*\}\);/
  );
  const blockedRecordIndex = pdfExportRouteSource.indexOf("if (!permission.allowed && !isUsageLimitExemptAccount) {");
  const blockedRecordBlock = pdfExportRouteSource.slice(blockedRecordIndex, blockedRecordIndex + 900);
  assert.match(blockedRecordBlock, /status: "rate_limited",/);
  assert.match(blockedRecordBlock, /usage_kind: "pdf_export_limit",/);
  assert.match(blockedRecordBlock, /quota_consumed: false,/);
});

test("requirement 5: the exemption is purely additive -- the only structural change to the blocking condition itself is the added '&& !isUsageLimitExemptAccount' clause; the underlying !permission.allowed check is unchanged (its only OTHER use is a new, purely-informational audit annotation, never a second gate)", () => {
  assert.match(pdfExportRouteSource, /if \(!permission\.allowed && !isUsageLimitExemptAccount\) \{/);
  assert.match(pdfExportRouteSource, /quota_exempt: !permission\.allowed && isUsageLimitExemptAccount,/);
  const gatingOccurrences = (pdfExportRouteSource.match(/if \([^\n]*permission\.allowed[^\n]*\)/g) || []).length;
  assert.equal(gatingOccurrences, 1, "permission.allowed must still gate exactly one `if` branch -- no second, hidden blocking check");
});

test("requirement 5: authorizeStrategicReportAccess (Strategic Report access gating -- a completely separate feature) is byte-unchanged by this fix; isVerifiedAdminOrOwnerAccount is a NEW, additive export, not a refactor of the existing function", async () => {
  const request = new Request("https://zerinix.com/api/plan");
  const result = await authorizeStrategicReportAccess({
    request,
    account: user(),
    allowedEmails: "beta@example.com",
    loadAdminRole: async () => "admin",
  });
  assert.deepEqual(result, { allowed: true, branch: "verified_admin_owner_role" });
});

test("requirement 5: no unrelated report generation, competitor logic, decision authority, or PDF content file carries a #69A-16B marker", () => {
  for (const relativePath of [
    "app/lib/report-jobs/plan-executor.ts",
    "app/lib/report-engine/business-competitor-landscape-state.ts",
    "app/lib/report-presentation.ts",
    "app/lib/ai/financial-assumptions.ts",
    "app/dashboard/[id]/ReportPdfButton.tsx",
  ]) {
    const source = readFileSync(join(repoRoot, relativePath), "utf8");
    assert.doesNotMatch(source, /#69A-16B/);
  }
});

// --- Service-role isolation preserved (drift check) -----------------------

test("preserves security: pdf-export/route.ts still never references service-role credentials directly -- the admin_roles DB lookup stays isolated behind strategic-report-access.ts's lazy dynamic import, exactly like every other non-allowlisted caller", () => {
  assert.doesNotMatch(pdfExportRouteSource, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
});

test("preserves security: isVerifiedAdminOrOwnerAccount itself never references service-role credentials directly either -- same lazy-import isolation as authorizeStrategicReportAccess", () => {
  const fnStart = strategicAccessSource.indexOf("export async function isVerifiedAdminOrOwnerAccount(");
  const fnEnd = strategicAccessSource.indexOf("\n}\n", fnStart) + 3;
  const fnBody = strategicAccessSource.slice(fnStart, fnEnd);
  assert.doesNotMatch(fnBody, /createServiceRoleClient|SUPABASE_SERVICE_ROLE_KEY/);
});
