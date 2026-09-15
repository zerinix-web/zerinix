import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const settingsPage = readFileSync("app/dashboard/settings/page.tsx", "utf8");
const settingsActions = readFileSync("app/dashboard/settings/actions.ts", "utf8");
const settingsData = readFileSync("app/dashboard/settings/settings-data.ts", "utf8");

test("settings page requires authentication before rendering account data", () => {
  assert.match(settingsPage, /getAuthenticatedUser\(supabase\)/);
  assert.match(settingsPage, /redirect\("\/login\?next=\/dashboard\/settings"\)/);
  assert.match(settingsPage, /loadUserSettingsProfile\(supabase, user\)/);
});

test("settings actions validate authenticated ownership server-side", () => {
  assert.match(settingsActions, /^"use server";/);
  assert.match(settingsActions, /getSettingsContext/);
  assert.match(settingsActions, /getAuthenticatedUser\(supabase\)/);
  assert.match(settingsActions, /user\.id/);
  assert.match(settingsActions, /\.from\("ai_chat_profiles"\)\.upsert/);
  assert.match(settingsActions, /user_id: user\.id/);
  assert.doesNotMatch(settingsActions, /targetUserId|requestedUserId|formData\.get\("user_id"\)/);
});

test("settings sensitive actions are rate limited and require confirmation", () => {
  assert.match(settingsActions, /checkRateLimit\(`settings:\$\{action\}:\$\{user\.id\}:\$\{ip\}`/);
  assert.match(settingsActions, /confirmation !== "SIGN OUT"/);
  assert.match(settingsActions, /confirmation !== "DELETE"/);
  assert.match(settingsActions, /validateIntent/);
});

test("password flow uses Supabase updateUser without exposing password values", () => {
  assert.match(settingsActions, /updatePassword/);
  assert.match(settingsActions, /supabase\.auth\.updateUser\(\{ password \}\)/);
  assert.match(settingsActions, /password\.length < 10/);
  assert.doesNotMatch(settingsPage, /defaultValue=\{.*password/i);
});

test("notification and theme preferences persist through user metadata", () => {
  assert.match(settingsPage, /name="notification_preference"/);
  assert.match(settingsPage, /name="theme_preference"/);
  assert.match(settingsActions, /notification_preference: notificationPreference/);
  assert.match(settingsActions, /theme_preference: themePreference/);
  assert.match(settingsData, /notificationPreference/);
  assert.match(settingsData, /themePreference/);
});

test("AI defaults persist through existing ai_chat_profiles only for the owner", () => {
  assert.match(settingsPage, /name="preferred_language"/);
  assert.match(settingsPage, /name="risk_tolerance"/);
  assert.match(settingsActions, /preferred_language: preferredLanguage/);
  assert.match(settingsActions, /risk_tolerance: riskTolerance/);
  assert.match(settingsData, /\.from\("ai_chat_profiles"\)/);
  assert.match(settingsData, /\.eq\("user_id", user\.id\)/);
});

test("session revocation uses global sign out and connected devices remain placeholder-only", () => {
  assert.match(settingsActions, /signOutAllDevices/);
  assert.match(settingsActions, /supabase\.auth\.signOut\(\{ scope: "global" \}\)/);
  assert.match(settingsPage, /Device-level session inventory is not connected yet/);
});

test("danger zone deletes the account through the server-only deletion service without exposing secrets", () => {
  const deleteAccountForm = readFileSync("components/account/DeleteAccountForm.tsx", "utf8");

  assert.match(settingsPage, /<DeleteAccountForm \/>/);
  assert.match(deleteAccountForm, /Delete account/);
  assert.match(deleteAccountForm, /action=\{deleteAccount\}/);
  assert.match(settingsActions, /deleteAccountWithServiceRole\(\{ userId: user\.id/);
  assert.doesNotMatch(settingsActions, /manual security review/);
  assert.doesNotMatch(settingsActions, /auth\.admin\.deleteUser|service_role|SERVICE_ROLE|createServiceRoleClient/);
  assert.doesNotMatch(settingsPage, /session token|refresh token|secret key|service-role/i);
});

test("settings page includes required production-ready settings sections", () => {
  for (const label of [
    "Profile",
    "Avatar upload",
    "Email verified",
    "Notifications",
    "Theme",
    "Language",
    "Timezone",
    "AI Defaults",
    "Privacy",
    "Connected devices",
    "API Keys",
    "Danger Zone",
    "Export personal data",
  ]) {
    assert.match(settingsPage, new RegExp(label));
  }
});
