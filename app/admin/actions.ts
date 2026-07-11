"use server";

import { revalidatePath } from "next/cache";
import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import {
  checkRateLimit,
  getServerActionClientIp,
} from "@/app/lib/security/rate-limit";
import { requireAdminPage, writeAdminAuditLog } from "./admin-data";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedPlans = new Set(["free", "pro", "business"]);
const allowedStatuses = new Set(["active", "suspended"]);

function readTargetUserId(formData: FormData) {
  const targetUserId = String(formData.get("target_user_id") || "").trim();

  return uuidPattern.test(targetUserId) ? targetUserId : "";
}

async function enforceAdminMutationRateLimit(adminUserId: string) {
  const ip = await getServerActionClientIp();
  const result = checkRateLimit(`admin:mutation:${adminUserId}:${ip}`, {
    limit: 20,
    windowMs: 60_000,
  });

  return result.allowed;
}

export async function updateUserAccountStatus(formData: FormData) {
  const admin = await requireAdminPage();
  const allowed = await enforceAdminMutationRateLimit(admin.user.id);

  if (!allowed) {
    return;
  }

  const targetUserId = readTargetUserId(formData);
  const status = String(formData.get("status") || "").trim().toLowerCase();

  if (!targetUserId || !allowedStatuses.has(status)) {
    return;
  }

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient.from("user_account_statuses").upsert(
    {
      user_id: targetUserId,
      status,
      updated_by: admin.user.id,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return;
  }

  await writeAdminAuditLog({
    adminUserId: admin.user.id,
    action: `user.${status}`,
    targetUserId,
    metadata: { status },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

export async function updateUserPlan(formData: FormData) {
  const admin = await requireAdminPage();
  const allowed = await enforceAdminMutationRateLimit(admin.user.id);

  if (!allowed) {
    return;
  }

  const targetUserId = readTargetUserId(formData);
  const plan = String(formData.get("plan") || "").trim().toLowerCase();

  if (!targetUserId || !allowedPlans.has(plan)) {
    return;
  }

  const serviceClient = createServiceRoleClient();
  const { error } = await serviceClient.from("user_billing_profiles").upsert(
    {
      user_id: targetUserId,
      plan_tier: plan,
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return;
  }

  await writeAdminAuditLog({
    adminUserId: admin.user.id,
    action: "user.plan_changed",
    targetUserId,
    metadata: { plan },
  });

  revalidatePath("/admin/users");
  revalidatePath("/admin");
}
