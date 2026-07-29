import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureFreeBillingProfile(
  supabase: SupabaseClient,
  userId: string
) {
  const { error } = await supabase.from("user_billing_profiles").insert({
    user_id: userId,
    plan_tier: "free",
  });

  if (!error || error.code === "23505") {
    return { ok: true } as const;
  }

  return { ok: false } as const;
}
