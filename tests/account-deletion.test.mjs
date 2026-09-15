import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const {
  ACCOUNT_DELETION_ADMIN_CHECKS,
  ACCOUNT_DELETION_DETACH_STEPS,
  ACCOUNT_DELETION_TABLE_STEPS,
  deleteUserAccount,
  getAccountDeletionErrorMessage,
} = await import("../app/lib/account/account-deletion.ts");

const USER_ID = "4f7c2b8e-0000-4000-8000-000000000001";
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migrationsDir = new URL("../supabase/migrations/", import.meta.url);
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

function createHarness(overrides = {}) {
  const calls = [];
  const deps = {
    store: {
      async countRows(table, column, value) {
        calls.push(["count", table, column, value]);
        return overrides.countRows?.(table, column) ?? { count: 0, error: null };
      },
      async loadBillingIdentifiers(userId) {
        calls.push(["billing", userId]);
        return overrides.billing ?? { customerId: null, subscriptionId: null, error: null };
      },
      async deleteRows(table, column, values) {
        calls.push(["delete", table, column, values]);
        return overrides.deleteRows?.(table, column) ?? { error: null };
      },
      async clearColumn(table, column, value) {
        calls.push(["detach", table, column, value]);
        return overrides.clearColumn?.(table, column) ?? { error: null };
      },
    },
    async cancelSubscriptions(input) {
      calls.push(["cancel", input]);
      return overrides.cancel ?? { ok: true };
    },
    async removeStoredFiles(userId) {
      calls.push(["files", userId]);
      return overrides.files ?? { ok: true };
    },
    async deleteAuthUser(userId) {
      calls.push(["auth", userId]);
      return overrides.auth ?? { ok: true };
    },
    logError() {},
  };

  return { calls, deps };
}

const callsOf = (calls, kind) => calls.filter((call) => call[0] === kind);

function assertNothingDeleted(calls) {
  for (const kind of ["cancel", "files", "delete", "detach", "auth"]) {
    assert.equal(callsOf(calls, kind).length, 0, `unexpected ${kind} call`);
  }
}

test("deletes every user-owned table, detaches kept records, and deletes the auth user last", async () => {
  const { calls, deps } = createHarness({
    billing: { customerId: "cus_123", subscriptionId: "sub_123", error: null },
  });

  const result = await deleteUserAccount({ userId: USER_ID, email: "Founder@Example.com" }, deps);

  assert.deepEqual(result, { ok: true });

  const cancelIndex = calls.findIndex((call) => call[0] === "cancel");
  const firstDataChange = calls.findIndex((call) => call[0] === "files" || call[0] === "delete");
  assert.ok(cancelIndex > -1 && cancelIndex < firstDataChange, "billing must be canceled before any data is deleted");
  assert.deepEqual(callsOf(calls, "cancel")[0][1], { customerId: "cus_123", subscriptionId: "sub_123" });

  const userIdDeletes = callsOf(calls, "delete").filter((call) => call[2] === "user_id");
  assert.deepEqual(
    userIdDeletes.map((call) => call[1]),
    ACCOUNT_DELETION_TABLE_STEPS.map((step) => step.table)
  );
  for (const call of userIdDeletes) {
    assert.deepEqual(call[3], [USER_ID]);
  }

  assert.deepEqual(
    callsOf(calls, "delete").find((call) => call[2] === "recipient_email"),
    ["delete", "email_delivery_events", "recipient_email", ["Founder@Example.com", "founder@example.com"]]
  );
  assert.deepEqual(
    callsOf(calls, "detach").map((call) => `${call[1]}.${call[2]}`),
    ACCOUNT_DELETION_DETACH_STEPS.map((step) => `${step.table}.${step.column}`)
  );
  assert.deepEqual(calls.at(-1), ["auth", USER_ID]);
});

test("child rows are deleted before the parents they reference", () => {
  const order = ACCOUNT_DELETION_TABLE_STEPS.map((step) => step.table);
  const migrations = migrationFiles.map((file) => readFileSync(new URL(file, migrationsDir), "utf8")).join("\n");

  // reports.workspace_id is ON DELETE RESTRICT, so deleting a workspace that
  // still has reports would fail.
  assert.match(migrations, /workspace_id uuid references public\.report_workspaces\(id\) on delete restrict/);
  assert.ok(order.indexOf("reports") < order.indexOf("report_workspaces"));
  assert.ok(order.indexOf("ai_messages") < order.indexOf("ai_conversations"));
  assert.ok(order.indexOf("report_jobs") < order.indexOf("reports"));
  assert.ok(order.indexOf("ai_usage_events") < order.indexOf("reports"));
});

test("every migration column referencing auth.users is deleted, detached, or guarded", () => {
  const handled = new Set(
    [...ACCOUNT_DELETION_TABLE_STEPS, ...ACCOUNT_DELETION_DETACH_STEPS, ...ACCOUNT_DELETION_ADMIN_CHECKS].map(
      (step) => `${step.table}.${step.column}`
    )
  );
  const references = new Set();

  for (const file of migrationFiles) {
    let table = "";

    for (const line of readFileSync(new URL(file, migrationsDir), "utf8").split("\n")) {
      const tableMatch = line.match(/(?:create table if not exists|alter table)\s+public\.([a-z_]+)/i);

      if (tableMatch) {
        table = tableMatch[1];
      }

      const columnMatch = line.match(
        /^\s*(?:add column if not exists\s+)?([a-z_]+)\s+uuid\b[^,]*references auth\.users/i
      );

      if (columnMatch && table) {
        references.add(`${table}.${columnMatch[1]}`);
      }
    }
  }

  assert.ok(references.size >= 15, "expected to find auth.users references in supabase/migrations");

  for (const reference of references) {
    assert.ok(handled.has(reference), `${reference} references auth.users but account deletion does not handle it`);
  }
});

test("skips Stripe when the account has no billing identifiers", async () => {
  const { calls, deps } = createHarness();

  assert.deepEqual(await deleteUserAccount({ userId: USER_ID, email: null }, deps), { ok: true });
  assert.equal(callsOf(calls, "cancel").length, 0);
  assert.equal(callsOf(calls, "delete").some((call) => call[2] === "recipient_email"), false);
  assert.deepEqual(calls.at(-1), ["auth", USER_ID]);
});

test("refuses administrator accounts before billing or data changes", async () => {
  for (const check of ACCOUNT_DELETION_ADMIN_CHECKS) {
    const { calls, deps } = createHarness({
      countRows: (table, column) =>
        table === check.table && column === check.column ? { count: 1, error: null } : undefined,
    });

    const result = await deleteUserAccount({ userId: USER_ID, email: "admin@example.com" }, deps);

    assert.deepEqual(result, { ok: false, code: "account_deletion_admin_account" });
    assertNothingDeleted(calls);
  }
});

test("stops before deleting anything when subscriptions cannot be canceled", async () => {
  const { calls, deps } = createHarness({
    billing: { customerId: "cus_123", subscriptionId: null, error: null },
    cancel: { ok: false },
  });

  const result = await deleteUserAccount({ userId: USER_ID, email: "founder@example.com" }, deps);

  assert.deepEqual(result, { ok: false, code: "account_deletion_billing_failed" });
  for (const kind of ["files", "delete", "detach", "auth"]) {
    assert.equal(callsOf(calls, kind).length, 0, `unexpected ${kind} call`);
  }
});

test("stops without deleting the auth user when a table delete fails", async () => {
  const { calls, deps } = createHarness({
    deleteRows: (table) => (table === "reports" ? { error: { code: "57014", message: "timeout" } } : undefined),
  });

  const result = await deleteUserAccount({ userId: USER_ID, email: "founder@example.com" }, deps);

  assert.deepEqual(result, { ok: false, code: "account_deletion_failed" });
  assert.equal(callsOf(calls, "auth").length, 0);
  assert.equal(callsOf(calls, "delete").some((call) => call[1] === "report_workspaces"), false);
});

test("tolerates tables or columns that do not exist in this environment", async () => {
  const { calls, deps } = createHarness({
    billing: { customerId: null, subscriptionId: null, error: { code: "42703" } },
    deleteRows: (table) => (table === "user_notifications" ? { error: { code: "PGRST205" } } : undefined),
    clearColumn: (table) => (table === "openai_cost_summaries" ? { error: { code: "42P01" } } : undefined),
  });

  assert.deepEqual(await deleteUserAccount({ userId: USER_ID, email: null }, deps), { ok: true });
  assert.deepEqual(calls.at(-1), ["auth", USER_ID]);
});

test("fails closed when storage cleanup, auth deletion, or a dependency throws", async () => {
  const storage = createHarness({ files: { ok: false } });
  assert.deepEqual(await deleteUserAccount({ userId: USER_ID, email: null }, storage.deps), {
    ok: false,
    code: "account_deletion_failed",
  });
  assert.equal(callsOf(storage.calls, "delete").length, 0);

  const auth = createHarness({ auth: { ok: false } });
  assert.deepEqual(await deleteUserAccount({ userId: USER_ID, email: null }, auth.deps), {
    ok: false,
    code: "account_deletion_failed",
  });

  const throwing = createHarness({
    deleteRows: () => {
      throw new Error("network down");
    },
  });
  assert.deepEqual(await deleteUserAccount({ userId: USER_ID, email: null }, throwing.deps), {
    ok: false,
    code: "account_deletion_failed",
  });
  assert.equal(callsOf(throwing.calls, "auth").length, 0);

  const empty = createHarness();
  assert.deepEqual(await deleteUserAccount({ userId: "  ", email: null }, empty.deps), {
    ok: false,
    code: "account_deletion_failed",
  });
  assert.equal(empty.calls.length, 0);
});

test("error messages are only returned for known deletion codes", () => {
  assert.match(getAccountDeletionErrorMessage("account_deletion_billing_failed"), /was not deleted/);
  assert.match(getAccountDeletionErrorMessage("account_deletion_admin_account"), /administrator/);
  assert.equal(getAccountDeletionErrorMessage("<b>fake</b>"), null);
  assert.equal(getAccountDeletionErrorMessage("toString"), null);
  assert.equal(getAccountDeletionErrorMessage(undefined), null);
});

test("in-app deletion runs server-side for the authenticated user only", () => {
  const actions = read("app/dashboard/settings/actions.ts");
  const service = read("app/lib/account/account-deletion-service.ts");
  const deletionAction = actions.slice(actions.indexOf("export async function deleteAccount"));

  assert.match(deletionAction, /confirmation !== "DELETE"/);
  assert.match(deletionAction, /getSettingsContext\("delete-account"\)/);
  assert.match(deletionAction, /deleteAccountWithServiceRole\(\{ userId: user\.id, email: user\.email \?\? null \}\)/);
  assert.match(deletionAction, /redirect\("\/delete-account\/deleted"\)/);
  assert.doesNotMatch(actions, /formData\.get\("user_id"\)|createServiceRoleClient/);
  assert.match(service, /^import "server-only";/m);
  assert.match(service, /auth\.admin\.deleteUser\(userId\)/);
  assert.match(service, /cancelStripeSubscriptionsForAccountDeletion/);
});

test("Stripe subscriptions are canceled through the Stripe API", () => {
  const stripe = read("app/lib/billing/stripe.ts");
  const helper = stripe.slice(stripe.indexOf("export async function cancelStripeSubscriptionsForAccountDeletion"));

  assert.match(helper, /requestStripeJson\("DELETE", `subscriptions\//);
  assert.match(helper, /status: "all"/);
  assert.match(helper, /resource_missing/);
  assert.match(helper, /STRIPE_SECRET_KEY is not configured/);
});

test("Settings exposes the same deletion form on desktop and mobile", () => {
  const page = read("app/dashboard/settings/page.tsx");
  const mobile = read("components/mobile/MobileAccountHome.tsx");
  const form = read("components/account/DeleteAccountForm.tsx");
  const deletedPage = read("app/delete-account/deleted/page.tsx");

  assert.match(page, /<DeleteAccountForm \/>/);
  assert.match(page, /accountDeletionError=\{accountDeletionError\}/);
  assert.match(mobile, /<DeleteAccountForm/);
  assert.match(form, /action=\{deleteAccount\}/);
  assert.match(form, /name="confirmation"/);
  assert.match(form, /canceled in Stripe immediately/);
  assert.doesNotMatch(page + mobile + form, /manual security review|Request deletion review/);
  assert.match(deletedPage, /<ClearDeletedAccountSession \/>/);
  assert.match(deletedPage, /index: false/);
});

test("public deletion and privacy pages describe the implemented process without unimplemented claims", () => {
  const deletePage = read("app/delete-account/page.tsx");
  const deletedPage = read("app/delete-account/deleted/page.tsx");
  const privacy = read("app/privacy/page.tsx");

  for (const source of [deletePage, deletedPage, privacy]) {
    assert.doesNotMatch(
      source,
      /verify (your|the) (request|identity)|identity verification|confirmation email|we will (email|notify) you/i
    );
  }

  assert.match(deletePage, /Delete Your ZERINIX Account/);
  assert.match(deletePage, /zerinix@zerinix\.com/);
  assert.match(deletePage, /Delete My ZERINIX Account/);
  assert.match(deletePage, /Permanently delete account/);
  assert.match(deletePage, /reasonable period/);
  assert.doesNotMatch(deletePage, /does not currently offer automated account deletion/);
  assert.match(privacy, /href="\/delete-account"/);
  assert.doesNotMatch(privacy, /manual review process/);
});
