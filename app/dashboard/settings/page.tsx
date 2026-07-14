import { redirect } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Download,
  Globe2,
  KeyRound,
  Languages,
  Laptop,
  Lock,
  LogOut,
  Mail,
  Palette,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
} from "lucide-react";
import { createClient } from "@/app/lib/supabase/server";
import DashboardSidebar from "../DashboardSidebar";
import { getAuthenticatedUser } from "../report-utils";
import {
  requestAccountDeletion,
  signOutAllDevices,
  updatePassword,
  updateProfileSettings,
} from "./actions";
import { loadUserSettingsProfile } from "./settings-data";

export const dynamic = "force-dynamic";

const timezoneOptions = ["UTC", "Europe/Istanbul", "Europe/London", "Europe/Berlin", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];
const languageOptions = ["English", "Turkish", "German", "French", "Spanish"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ settings_notice?: string; settings_error?: string }>;
}) {
  const supabase = await createClient();
  const user = await getAuthenticatedUser(supabase);

  if (!user) {
    redirect("/login?next=/dashboard/settings");
  }

  const [{ settings_notice: notice, settings_error: error }, settings] = await Promise.all([
    searchParams,
    loadUserSettingsProfile(supabase, user),
  ]);
  const displayNameLabel = settings.displayName || "Display name not set";

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 z-0 bg-[radial-gradient(circle_at_top_right,rgba(45,212,191,0.14),transparent_30%),radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.055),transparent_28%),linear-gradient(180deg,rgba(255,255,255,0.025),transparent_36%)]" />
      <div className="relative z-10 flex min-h-screen flex-col lg:flex-row">
        <DashboardSidebar />

        <section className="flex-1 px-5 pt-6 pb-28 sm:px-8 lg:px-10 lg:py-9">
          <div className="overflow-hidden rounded-[2.35rem] border border-white/10 bg-white/[0.045] shadow-2xl shadow-black/35 backdrop-blur-2xl">
            <div className="relative p-6 sm:p-8 lg:p-10">
              <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.09),transparent_38%),radial-gradient(circle_at_85%_20%,rgba(45,212,191,0.16),transparent_34%)]" />
              <div className="relative flex flex-col gap-8 xl:flex-row xl:items-end xl:justify-between">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold tracking-[0.24em] text-teal-100 shadow-lg shadow-teal-950/20">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    SETTINGS
                  </div>
                  <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-white md:text-6xl">
                    Account controls for your AI workspace.
                  </h1>
                  <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-400">
                    Manage profile details, preferences, security controls, AI defaults
                    and privacy choices without exposing sensitive account data.
                  </p>
                </div>

                <div className="rounded-[1.5rem] border border-white/10 bg-black/30 p-5 xl:min-w-80">
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-zinc-500">
                    Signed in as
                  </p>
                  <p className="mt-3 truncate text-xl font-semibold text-white">
                    {displayNameLabel}
                  </p>
                  <p className="mt-1 truncate text-sm text-zinc-500">{settings.email}</p>
                  <p className="mt-3 inline-flex items-center gap-2 text-sm text-zinc-500">
                    {settings.emailVerified ? (
                      <CheckCircle2 className="h-4 w-4 text-teal-200" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-amber-200" />
                    )}
                    {settings.emailVerified ? "Email verified" : "Email not verified"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {notice ? (
            <div className="mt-6 rounded-3xl border border-teal-300/20 bg-teal-300/10 p-5 text-sm leading-6 text-teal-50">
              {notice}
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-3xl border border-red-300/20 bg-red-950/30 p-5 text-sm leading-6 text-red-100">
              Settings could not be updated. Please try again shortly.
            </div>
          ) : null}

          <form action={updateProfileSettings} className="mt-6 grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <input type="hidden" name="intent" value="update_profile_settings" />
            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <UserRound className="h-5 w-5 text-teal-200" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Profile
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Public account information
                  </h2>
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Display name
                  <input
                    name="display_name"
                    defaultValue={settings.displayName}
                    placeholder="Add a display name"
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                  />
                  <span className="text-xs font-normal leading-5 text-zinc-600">
                    This name appears in your private workspace only. Your email stays unchanged.
                  </span>
                </label>

                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Email
                  <span className="inline-flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-black/25 px-4 text-sm text-zinc-400">
                    <Mail className="h-4 w-4 text-teal-200" />
                    {settings.email}
                  </span>
                </label>

                <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04]">
                      {settings.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={settings.avatarUrl}
                          alt=""
                          className="h-full w-full rounded-2xl object-cover"
                        />
                      ) : (
                        <UserRound className="h-6 w-6 text-teal-200" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-white">Avatar upload</p>
                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                          Coming soon
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-6 text-zinc-500">
                        Secure avatar storage is not configured yet. Upload controls are
                        intentionally disabled until file ownership and signed URLs are ready.
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled
                      aria-disabled="true"
                      className="inline-flex cursor-not-allowed items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-medium text-zinc-500"
                    >
                      <Upload className="h-4 w-4" />
                      Upload
                    </button>
                  </div>
                </div>
              </div>
            </section>

            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <Palette className="h-5 w-5 text-teal-200" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Preferences
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Product defaults
                  </h2>
                </div>
              </div>

              <div className="mt-6 grid gap-4">
                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Theme
                  <select
                    name="theme_preference"
                    defaultValue={settings.themePreference}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-teal-300/40"
                  >
                    <option value="system">System</option>
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>

                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Language
                  <select
                    name="preferred_language"
                    defaultValue={settings.preferredLanguage}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-teal-300/40"
                  >
                    {languageOptions.map((language) => (
                      <option key={language} value={language}>
                        {language}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs font-normal leading-5 text-zinc-600">
                    The product interface remains English. Report content follows the
                    language of your prompt when possible.
                  </span>
                </label>

                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Timezone
                  <select
                    name="timezone_preference"
                    defaultValue={settings.timezonePreference}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-teal-300/40"
                  >
                    {timezoneOptions.map((timezone) => (
                      <option key={timezone} value={timezone}>
                        {timezone}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Notifications
                  <select
                    name="notification_preference"
                    defaultValue={settings.notificationPreference}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-teal-300/40"
                  >
                    <option value="all">All notifications</option>
                    <option value="product">Product updates only</option>
                    <option value="security">Security only</option>
                    <option value="none">No non-essential notifications</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <Bot className="h-5 w-5 text-teal-200" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    AI Defaults
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Workspace intelligence defaults
                  </h2>
                </div>
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Response mode
                  <select
                    name="ai_default_mode"
                    defaultValue={settings.aiDefaultMode}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-teal-300/40"
                  >
                    <option value="fast">Fast</option>
                    <option value="balanced">Balanced</option>
                    <option value="deep">Deep analysis</option>
                  </select>
                </label>

                <label className="grid gap-2 text-sm font-medium text-zinc-300">
                  Risk tolerance
                  <select
                    name="risk_tolerance"
                    defaultValue={settings.riskTolerance}
                    className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none focus:border-teal-300/40"
                  >
                    <option value="Conservative">Conservative</option>
                    <option value="Moderate">Moderate</option>
                    <option value="Aggressive">Aggressive</option>
                  </select>
                </label>
              </div>
            </section>

            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <ShieldCheck className="h-5 w-5 text-teal-200" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Privacy
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Data preferences
                  </h2>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/25 p-4">
                  <input
                    type="checkbox"
                    name="privacy_analytics"
                    defaultChecked={settings.privacyAnalytics}
                    className="mt-1 h-4 w-4 accent-teal-300"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">
                      Product analytics
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-zinc-500">
                      Allow non-sensitive product telemetry to improve reliability.
                    </span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-2xl border border-white/10 bg-black/25 p-4">
                  <input
                    type="checkbox"
                    name="privacy_product_updates"
                    defaultChecked={settings.privacyProductUpdates}
                    className="mt-1 h-4 w-4 accent-teal-300"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-white">
                      Product updates
                    </span>
                    <span className="mt-1 block text-sm leading-6 text-zinc-500">
                      Receive non-essential product and feature announcements.
                    </span>
                  </span>
                </label>
              </div>
            </section>

            <div className="xl:col-span-2">
              <button
                type="submit"
                className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-white px-6 text-sm font-semibold text-black shadow-xl shadow-white/10 transition hover:-translate-y-0.5 hover:bg-zinc-200"
              >
                Save settings
              </button>
            </div>
          </form>

          <div className="mt-6 grid gap-5 xl:grid-cols-2">
            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <Lock className="h-5 w-5 text-teal-200" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Security
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Password
                  </h2>
                </div>
              </div>
              <form action={updatePassword} className="mt-6 grid gap-4">
                <input type="hidden" name="intent" value="update_password" />
                <input
                  name="password"
                  type="password"
                  minLength={10}
                  required
                  autoComplete="new-password"
                  placeholder="New password"
                  aria-label="New password"
                  className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                />
                <input
                  name="password_confirmation"
                  type="password"
                  minLength={10}
                  required
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  aria-label="Confirm new password"
                  className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-teal-300/40 focus:ring-2 focus:ring-teal-200/10"
                />
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10 px-4 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/15 focus:outline-none focus:ring-2 focus:ring-teal-200/20"
                >
                  Update password
                </button>
              </form>
            </section>

            <section className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl">
              <div className="flex items-start gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-teal-300/20 bg-teal-300/10">
                  <Laptop className="h-5 w-5 text-teal-200" />
                </span>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-zinc-500">
                    Sessions
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold text-white">
                    Connected devices
                  </h2>
                </div>
              </div>
              <div className="mt-6 rounded-2xl border border-white/10 bg-black/25 p-4 text-sm leading-6 text-zinc-500">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-white">Device inventory</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Coming soon
                  </span>
                </div>
                <p className="mt-2">
                  Device-level session inventory is not connected yet. You can still
                  revoke all active sessions securely using the confirmation action below.
                </p>
              </div>
              <form action={signOutAllDevices} className="mt-4 grid gap-3">
                <input type="hidden" name="intent" value="sign_out_all_devices" />
                <input
                  name="confirmation"
                  required
                  autoComplete="off"
                  placeholder="Type SIGN OUT"
                  aria-label="Type SIGN OUT to confirm"
                  className="min-h-12 rounded-2xl border border-white/10 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-zinc-600 focus:border-red-300/40 focus:ring-2 focus:ring-red-200/10"
                />
                <button
                  type="submit"
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-red-300/25 bg-red-300/10 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-300/15 focus:outline-none focus:ring-2 focus:ring-red-200/20"
                >
                  <LogOut className="h-4 w-4" />
                  Sign out all devices
                </button>
              </form>
            </section>
          </div>

          <div className="mt-6 grid gap-5 xl:grid-cols-3">
            {[
              {
                icon: KeyRound,
                title: "API Keys",
                body: "Coming soon. User API keys are not supported yet, so no credentials or access tokens are displayed in this settings area.",
              },
              {
                icon: Globe2,
                title: "Regional controls",
                body: `Timezone preference: ${settings.timezonePreference}. Regional billing and tax controls are coming soon and remain disabled until billing configuration is complete.`,
              },
              {
                icon: Languages,
                title: "Language behavior",
                body: `Default language preference: ${settings.preferredLanguage}. Report body language still follows the user's prompt language.`,
              },
            ].map((item) => {
              const Icon = item.icon;

              return (
                <section
                  key={item.title}
                  className="rounded-[1.85rem] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25 backdrop-blur-xl"
                >
                  <Icon className="h-5 w-5 text-teal-200" />
                  <h2 className="mt-4 text-xl font-semibold text-white">{item.title}</h2>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">{item.body}</p>
                </section>
              );
            })}
          </div>

          <section className="mt-6 rounded-[1.85rem] border border-red-300/20 bg-red-950/20 p-6 shadow-2xl shadow-black/25">
            <div className="flex items-start gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-red-300/25 bg-red-300/10">
                <AlertTriangle className="h-5 w-5 text-red-100" />
              </span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-red-100/70">
                  Danger Zone
                </p>
                <h2 className="mt-2 text-2xl font-semibold text-white">
                  Sensitive account actions
                </h2>
                <p className="mt-2 text-sm leading-6 text-red-100/75">
                  These actions require confirmation and are rate-limited on the server.
                </p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-2">
              <section className="rounded-2xl border border-white/10 bg-black/25 p-4">
                <Download className="h-5 w-5 text-teal-200" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">Export personal data</h3>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Coming soon
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-zinc-500">
                  Automated exports are not connected yet. This action is disabled
                  until the secure export workflow is available.
                </p>
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="mt-4 inline-flex min-h-10 cursor-not-allowed items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-sm font-semibold text-zinc-500"
                >
                  Export unavailable
                </button>
              </section>

              <form action={requestAccountDeletion} className="rounded-2xl border border-red-300/20 bg-red-950/20 p-4">
                <input type="hidden" name="intent" value="delete_account" />
                <Trash2 className="h-5 w-5 text-red-100" />
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-white">Delete account</h3>
                  <span className="rounded-full border border-red-300/20 bg-red-300/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-red-100/70">
                    Manual review
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-red-100/75">
                  Automatic deletion is not available yet. This request starts a manual
                  security review and does not immediately remove your account or data.
                </p>
                <input
                  name="confirmation"
                  required
                  autoComplete="off"
                  placeholder="Type DELETE"
                  aria-label="Type DELETE to request account deletion review"
                  className="mt-4 min-h-11 w-full rounded-2xl border border-red-300/20 bg-black/35 px-4 text-sm text-white outline-none placeholder:text-red-100/35 focus:border-red-300/40 focus:ring-2 focus:ring-red-200/10"
                />
                <button
                  type="submit"
                  className="mt-3 inline-flex min-h-10 items-center justify-center rounded-2xl border border-red-300/25 bg-red-300/10 px-4 text-sm font-semibold text-red-100 transition hover:bg-red-300/15 focus:outline-none focus:ring-2 focus:ring-red-200/20"
                >
                  Request deletion review
                </button>
              </form>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}
