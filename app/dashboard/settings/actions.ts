"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAccountWithServiceRole } from "@/app/lib/account/account-deletion-service";
import { logServerError } from "@/app/lib/security/errors";
import { createClient } from "@/app/lib/supabase/server";
import { checkRateLimit, getServerActionClientIp } from "@/app/lib/security/rate-limit";
import { getAuthenticatedUser } from "../report-utils";

const allowedThemes = new Set(["system", "dark", "light"]);
const allowedNotifications = new Set(["all", "product", "security", "none"]);
const allowedAiModes = new Set(["fast", "balanced", "deep"]);
const allowedRiskTolerance = new Set(["Conservative", "Moderate", "Aggressive"]);

function settingsRedirect(params: Record<string, string>): never {
  const searchParams = new URLSearchParams(params);

  redirect(`/dashboard/settings?${searchParams.toString()}`);
}

async function getSettingsContext(action: string) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login?next=/dashboard/settings");
  }

  const ip = await getServerActionClientIp();
  const rateLimit = checkRateLimit(`settings:${action}:${user.id}:${ip}`, {
    limit: 8,
    windowMs: 10 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    settingsRedirect({
      settings_error: "Too many settings attempts. Please wait before trying again.",
    });
  }

  return { supabase, user };
}

function readString(formData: FormData, key: string, maxLength = 160) {
  return String(formData.get(key) || "").trim().slice(0, maxLength);
}

function readBoolean(formData: FormData, key: string) {
  return formData.get(key) === "on";
}

function validateIntent(formData: FormData, expected: string) {
  return readString(formData, "intent", 80) === expected;
}

export async function updateProfileSettings(formData: FormData) {
  if (!validateIntent(formData, "update_profile_settings")) {
    settingsRedirect({ settings_error: "Invalid settings request." });
  }

  const { supabase, user } = await getSettingsContext("profile");
  const displayName = readString(formData, "display_name", 96);
  const themePreference = readString(formData, "theme_preference", 24);
  const notificationPreference = readString(formData, "notification_preference", 24);
  const timezonePreference = readString(formData, "timezone_preference", 80);
  const preferredLanguage = readString(formData, "preferred_language", 64);
  const aiDefaultMode = readString(formData, "ai_default_mode", 24);
  const riskTolerance = readString(formData, "risk_tolerance", 32);
  const privacyAnalytics = readBoolean(formData, "privacy_analytics");
  const privacyProductUpdates = readBoolean(formData, "privacy_product_updates");

  if (
    !allowedThemes.has(themePreference) ||
    !allowedNotifications.has(notificationPreference) ||
    !allowedAiModes.has(aiDefaultMode) ||
    !allowedRiskTolerance.has(riskTolerance)
  ) {
    settingsRedirect({ settings_error: "One or more settings values are invalid." });
  }

  const { error: profileError } = await supabase.auth.updateUser({
    data: {
      full_name: displayName,
      theme_preference: themePreference,
      notification_preference: notificationPreference,
      timezone_preference: timezonePreference,
      preferred_language: preferredLanguage,
      ai_default_mode: aiDefaultMode,
      privacy_analytics: privacyAnalytics,
      privacy_product_updates: privacyProductUpdates,
    },
  });

  if (profileError) {
    settingsRedirect({ settings_error: "Profile settings could not be saved." });
  }

  const { error: aiProfileError } = await supabase.from("ai_chat_profiles").upsert(
    {
      user_id: user.id,
      preferred_language: preferredLanguage,
      risk_tolerance: riskTolerance,
    },
    { onConflict: "user_id" }
  );

  if (aiProfileError) {
    settingsRedirect({ settings_error: "AI default settings could not be saved." });
  }

  revalidatePath("/dashboard/settings");
  settingsRedirect({ settings_notice: "Settings saved." });
}

export async function updatePassword(formData: FormData) {
  if (!validateIntent(formData, "update_password")) {
    settingsRedirect({ settings_error: "Invalid password request." });
  }

  const { supabase } = await getSettingsContext("password");
  const password = String(formData.get("password") || "");
  const confirmation = String(formData.get("password_confirmation") || "");

  if (password.length < 10 || password !== confirmation) {
    settingsRedirect({
      settings_error: "Enter matching passwords with at least 10 characters.",
    });
  }

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    settingsRedirect({ settings_error: "Password could not be updated." });
  }

  settingsRedirect({ settings_notice: "Password updated." });
}

export async function signOutAllDevices(formData: FormData) {
  if (!validateIntent(formData, "sign_out_all_devices")) {
    settingsRedirect({ settings_error: "Invalid session request." });
  }

  const confirmation = readString(formData, "confirmation", 64);

  if (confirmation !== "SIGN OUT") {
    settingsRedirect({ settings_error: "Type SIGN OUT to confirm session revocation." });
  }

  const { supabase } = await getSettingsContext("sessions");

  await supabase.auth.signOut({ scope: "global" });
  redirect("/login?auth_notice=signed_out_all_devices");
}

export async function requestPersonalDataExport(formData: FormData) {
  if (!validateIntent(formData, "export_personal_data")) {
    settingsRedirect({ settings_error: "Invalid export request." });
  }

  await getSettingsContext("data-export");
  settingsRedirect({
    settings_notice: "Data export is not automated yet. Contact support to request a secure export.",
  });
}

// Permanently deletes the signed-in user's account (see
// app/lib/account/account-deletion.ts for the exact order and scope). The
// user id always comes from the authenticated session, never from the form.
export async function deleteAccount(formData: FormData) {
  if (!validateIntent(formData, "delete_account")) {
    settingsRedirect({ settings_error: "Invalid deletion request." });
  }

  const confirmation = readString(formData, "confirmation", 64);

  if (confirmation !== "DELETE") {
    settingsRedirect({ settings_error: "Type DELETE to confirm account deletion." });
  }

  const { supabase, user } = await getSettingsContext("delete-account");
  const result = await deleteAccountWithServiceRole({ userId: user.id, email: user.email ?? null });

  if (!result.ok) {
    settingsRedirect({ settings_error: result.code });
  }

  try {
    // The auth user no longer exists; this only clears the session cookies.
    await supabase.auth.signOut({ scope: "local" });
  } catch (error) {
    logServerError("settings:delete-account:sign-out", error);
  }

  redirect("/delete-account/deleted");
}
