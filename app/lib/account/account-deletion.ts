// Account deletion orchestration for the authenticated in-app flow
// (Account settings -> Delete account). Deliberately free of runtime
// imports so tests/account-deletion.test.mjs can exercise it directly under
// plain `node --test`; the Supabase service-role, Stripe, and Storage
// adapters live in account-deletion-service.ts.
//
// Order matters:
//   1. Refuse administrator accounts. admin_audit_log.admin_user_id is
//      ON DELETE RESTRICT, and removing staff access is not self-service.
//   2. Cancel Stripe subscriptions before touching any data, and stop if
//      that fails, so a deleted account can never keep being billed.
//   3. Delete user-owned rows explicitly instead of relying only on
//      ON DELETE CASCADE, so the result does not depend on every
//      production table carrying the foreign keys in supabase/migrations.
//      reports goes before report_workspaces because reports.workspace_id
//      is ON DELETE RESTRICT.
//   4. Detach the user id from the records that are intentionally kept
//      (AI cost accounting and admin audit history).
//   5. Delete the Supabase Auth user last. Every earlier step is
//      idempotent, so a run that fails part-way can simply be retried.

export type AccountDeletionErrorCode =
  | "account_deletion_admin_account"
  | "account_deletion_billing_failed"
  | "account_deletion_unavailable"
  | "account_deletion_failed";

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; code: AccountDeletionErrorCode };

type StoreError = { code?: string; message?: string } | null | undefined;

export type AccountDeletionStore = {
  countRows(
    table: string,
    column: string,
    value: string
  ): Promise<{ count: number | null; error: StoreError }>;
  loadBillingIdentifiers(userId: string): Promise<{
    customerId: string | null;
    subscriptionId: string | null;
    error: StoreError;
  }>;
  deleteRows(
    table: string,
    column: string,
    values: string[]
  ): Promise<{ error: StoreError }>;
  clearColumn(
    table: string,
    column: string,
    value: string
  ): Promise<{ error: StoreError }>;
};

export type AccountDeletionDependencies = {
  store: AccountDeletionStore;
  cancelSubscriptions(input: {
    customerId: string | null;
    subscriptionId: string | null;
  }): Promise<{ ok: boolean }>;
  removeStoredFiles(userId: string): Promise<{ ok: boolean }>;
  deleteAuthUser(userId: string): Promise<{ ok: boolean }>;
  logError(scope: string, error: unknown): void;
};

type TableColumn = { table: string; column: string };

// A row in either table means the user is (or was) ZERINIX staff.
export const ACCOUNT_DELETION_ADMIN_CHECKS: readonly TableColumn[] = [
  { table: "admin_roles", column: "user_id" },
  { table: "admin_audit_log", column: "admin_user_id" },
];

// Every user-owned table, children before parents.
export const ACCOUNT_DELETION_TABLE_STEPS: readonly TableColumn[] = [
  { table: "report_jobs", column: "user_id" },
  { table: "ai_execution_claims", column: "user_id" },
  { table: "ai_usage_events", column: "user_id" },
  { table: "ai_response_cache", column: "user_id" },
  { table: "ai_abuse_events", column: "user_id" },
  { table: "ai_messages", column: "user_id" },
  { table: "ai_conversations", column: "user_id" },
  { table: "user_memories", column: "user_id" },
  { table: "ai_chat_profiles", column: "user_id" },
  { table: "user_notifications", column: "user_id" },
  { table: "email_delivery_events", column: "user_id" },
  { table: "stripe_invoices", column: "user_id" },
  { table: "user_billing_profiles", column: "user_id" },
  { table: "user_account_statuses", column: "user_id" },
  { table: "reports", column: "user_id" },
  { table: "report_workspaces", column: "user_id" },
];

// Records kept after deletion, with the user id removed. None of them
// stores prompt, message, or report content.
export const ACCOUNT_DELETION_DETACH_STEPS: readonly TableColumn[] = [
  { table: "openai_cost_events", column: "user_id" },
  { table: "openai_cost_summaries", column: "user_id" },
  { table: "admin_audit_log", column: "target_user_id" },
  { table: "user_account_statuses", column: "updated_by" },
];

// Undefined table/column errors (Postgres and PostgREST): a table or
// column that does not exist in this environment holds nothing to delete.
const MISSING_SCHEMA_ERROR_CODES = new Set(["42P01", "42703", "PGRST204", "PGRST205"]);

export function isMissingSchemaError(error: StoreError) {
  return Boolean(error?.code && MISSING_SCHEMA_ERROR_CODES.has(error.code));
}

const ACCOUNT_DELETION_ERROR_MESSAGES: Record<AccountDeletionErrorCode, string> = {
  account_deletion_admin_account:
    "Accounts with ZERINIX administrator access can't be deleted from Settings. Contact zerinix@zerinix.com to have administrator access removed first.",
  account_deletion_billing_failed:
    "Your subscription could not be canceled, so your account was not deleted. Please try again, or contact zerinix@zerinix.com.",
  account_deletion_unavailable:
    "Account deletion is temporarily unavailable, and your account was not deleted. Please try again later, or contact zerinix@zerinix.com.",
  account_deletion_failed:
    "Account deletion could not be completed, and some data may already have been removed. Please try again, or contact zerinix@zerinix.com.",
};

export function getAccountDeletionErrorMessage(code: string | null | undefined) {
  if (!code || !Object.prototype.hasOwnProperty.call(ACCOUNT_DELETION_ERROR_MESSAGES, code)) {
    return null;
  }

  return ACCOUNT_DELETION_ERROR_MESSAGES[code as AccountDeletionErrorCode];
}

function failure(code: AccountDeletionErrorCode): AccountDeletionResult {
  return { ok: false, code };
}

function normalizeRecipientEmails(email: string | null) {
  const trimmed = email?.trim() ?? "";

  return trimmed ? [...new Set([trimmed, trimmed.toLowerCase()])] : [];
}

export async function deleteUserAccount(
  input: { userId: string; email: string | null },
  deps: AccountDeletionDependencies
): Promise<AccountDeletionResult> {
  const userId = input.userId.trim();

  if (!userId) {
    return failure("account_deletion_failed");
  }

  try {
    for (const check of ACCOUNT_DELETION_ADMIN_CHECKS) {
      const { count, error } = await deps.store.countRows(check.table, check.column, userId);

      if (error && !isMissingSchemaError(error)) {
        deps.logError(`account:deletion:check:${check.table}`, error);
        return failure("account_deletion_failed");
      }

      if (!error && (count ?? 0) > 0) {
        return failure("account_deletion_admin_account");
      }
    }

    const billing = await deps.store.loadBillingIdentifiers(userId);

    if (billing.error && !isMissingSchemaError(billing.error)) {
      deps.logError("account:deletion:billing-profile", billing.error);
      return failure("account_deletion_failed");
    }

    if (billing.customerId || billing.subscriptionId) {
      const cancellation = await deps.cancelSubscriptions({
        customerId: billing.customerId,
        subscriptionId: billing.subscriptionId,
      });

      if (!cancellation.ok) {
        return failure("account_deletion_billing_failed");
      }
    }

    const files = await deps.removeStoredFiles(userId);

    if (!files.ok) {
      return failure("account_deletion_failed");
    }

    for (const step of ACCOUNT_DELETION_TABLE_STEPS) {
      const { error } = await deps.store.deleteRows(step.table, step.column, [userId]);

      if (error && !isMissingSchemaError(error)) {
        deps.logError(`account:deletion:delete:${step.table}`, error);
        return failure("account_deletion_failed");
      }
    }

    // Delivery logs for emails sent to this address, including any that
    // were not linked to the account by user id.
    const recipientEmails = normalizeRecipientEmails(input.email);

    if (recipientEmails.length) {
      const { error } = await deps.store.deleteRows(
        "email_delivery_events",
        "recipient_email",
        recipientEmails
      );

      if (error && !isMissingSchemaError(error)) {
        deps.logError("account:deletion:delete:email_delivery_events:recipient", error);
        return failure("account_deletion_failed");
      }
    }

    for (const step of ACCOUNT_DELETION_DETACH_STEPS) {
      const { error } = await deps.store.clearColumn(step.table, step.column, userId);

      if (error && !isMissingSchemaError(error)) {
        deps.logError(`account:deletion:detach:${step.table}`, error);
        return failure("account_deletion_failed");
      }
    }

    const authUser = await deps.deleteAuthUser(userId);

    if (!authUser.ok) {
      return failure("account_deletion_failed");
    }

    return { ok: true };
  } catch (error) {
    deps.logError("account:deletion:unexpected", error);
    return failure("account_deletion_failed");
  }
}
