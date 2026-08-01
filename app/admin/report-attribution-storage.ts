import "server-only";

import { createServiceRoleClient } from "@/app/lib/supabase/admin";
import { getSupabaseServiceRoleKey } from "@/app/lib/supabase/env";

type AttributionInput = {
  userId: string;
  reportId: string;
  reportRequestId: string;
};

type AttributionResult =
  | { ok: true }
  | { ok: false; reason: "service_role_unavailable" | "attribution_write_unavailable" };

export async function attributeReportUsageWithServerStorage(
  input: AttributionInput
): Promise<AttributionResult> {
  if (!getSupabaseServiceRoleKey()) {
    return { ok: false, reason: "service_role_unavailable" };
  }

  try {
    const serviceClient = createServiceRoleClient();
    const { error } = await serviceClient
      .from("ai_usage_events")
      .update({
        report_id: input.reportId,
        report_request_id: input.reportRequestId,
      })
      .eq("user_id", input.userId)
      .eq("report_request_id", input.reportRequestId);

    return error
      ? { ok: false, reason: "attribution_write_unavailable" }
      : { ok: true };
  } catch {
    return { ok: false, reason: "service_role_unavailable" };
  }
}
