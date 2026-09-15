import "server-only";

import { cancelStripeSubscriptionsForAccountDeletion } from "@/app/lib/billing/stripe";
import { getStorageConfiguration } from "@/app/lib/integrations/storage";
import { logServerError } from "@/app/lib/security/errors";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import {
  deleteUserAccount,
  type AccountDeletionResult,
  type AccountDeletionStore,
} from "./account-deletion";

// Server-only adapters for app/lib/account/account-deletion.ts. Uses the
// service-role client because deleting the Supabase Auth user and clearing
// rows the user cannot write through RLS (billing, audit, cost records)
// both require it. Callers must pass the id of the already-authenticated
// user -- never an id taken from request input.

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

const STORAGE_LIST_PAGE_SIZE = 1000;
const STORAGE_REMOVE_BATCH_SIZE = 100;
const STORAGE_MAX_FOLDER_DEPTH = 5;

function readId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function createStore(client: ServiceRoleClient): AccountDeletionStore {
  return {
    async countRows(table, column, value) {
      const { count, error } = await client
        .from(table)
        .select("*", { count: "exact", head: true })
        .eq(column, value);

      return { count, error };
    },
    async loadBillingIdentifiers(userId) {
      const { data, error } = await client
        .from("user_billing_profiles")
        .select("stripe_customer_id,stripe_subscription_id")
        .eq("user_id", userId)
        .maybeSingle();

      return {
        customerId: readId(data?.stripe_customer_id),
        subscriptionId: readId(data?.stripe_subscription_id),
        error,
      };
    },
    async deleteRows(table, column, values) {
      const { error } = await client.from(table).delete().in(column, values);

      return { error };
    },
    async clearColumn(table, column, value) {
      const { error } = await client
        .from(table)
        .update({ [column]: null })
        .eq(column, value);

      return { error };
    },
  };
}

async function listStoragePaths(
  client: ServiceRoleClient,
  bucket: string,
  prefix: string,
  depth: number
): Promise<string[] | null> {
  const paths: string[] = [];
  let offset = 0;

  for (;;) {
    const { data, error } = await client.storage
      .from(bucket)
      .list(prefix, { limit: STORAGE_LIST_PAGE_SIZE, offset });

    if (error) {
      // A configured bucket that was never created holds no files.
      if (/not.?found/i.test(error.message)) {
        return paths;
      }

      logServerError("account:deletion:storage-list", error);
      return null;
    }

    const items = data ?? [];

    for (const item of items) {
      const path = `${prefix}/${item.name}`;

      // Folder placeholders come back without an id.
      if (!item.id && depth < STORAGE_MAX_FOLDER_DEPTH) {
        const nested = await listStoragePaths(client, bucket, path, depth + 1);

        if (!nested) {
          return null;
        }

        paths.push(...nested);
      } else {
        paths.push(path);
      }
    }

    if (items.length < STORAGE_LIST_PAGE_SIZE) {
      return paths;
    }

    offset += items.length;
  }
}

// Uploads are stored under "<userId>/..." (see createUserStoragePath).
async function removeUserStorageObjects(client: ServiceRoleClient, userId: string) {
  const { buckets } = getStorageConfiguration();
  const bucketNames = [...new Set(Object.values(buckets).filter(Boolean))];

  for (const bucket of bucketNames) {
    const paths = await listStoragePaths(client, bucket, userId, 0);

    if (!paths) {
      return { ok: false };
    }

    for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH_SIZE) {
      const { error } = await client.storage
        .from(bucket)
        .remove(paths.slice(index, index + STORAGE_REMOVE_BATCH_SIZE));

      if (error) {
        logServerError("account:deletion:storage-remove", error);
        return { ok: false };
      }
    }
  }

  return { ok: true };
}

export async function deleteAccountWithServiceRole(input: {
  userId: string;
  email: string | null;
}): Promise<AccountDeletionResult> {
  let client: ServiceRoleClient;

  try {
    client = createServiceRoleClient();
  } catch (error) {
    logServerError("account:deletion:service-client", error);
    return { ok: false, code: "account_deletion_unavailable" };
  }

  return deleteUserAccount(input, {
    store: createStore(client),
    async cancelSubscriptions(billing) {
      const result = await cancelStripeSubscriptionsForAccountDeletion(billing);

      if (!result.ok) {
        logServerError("account:deletion:stripe", new Error(result.message));
      }

      return { ok: result.ok };
    },
    removeStoredFiles: (userId) => removeUserStorageObjects(client, userId),
    async deleteAuthUser(userId) {
      const { error } = await client.auth.admin.deleteUser(userId);

      // 404: the auth user is already gone (for example, a retried request).
      if (!error || error.status === 404) {
        return { ok: true };
      }

      logServerError("account:deletion:auth-user", error);
      return { ok: false };
    },
    logError: logServerError,
  });
}
