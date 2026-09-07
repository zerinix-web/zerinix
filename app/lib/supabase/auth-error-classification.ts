import { isAuthRetryableFetchError } from "@supabase/supabase-js";

// TASK #69A-21 -- shared classifier for supabase.auth.signInWithPassword
// failures, extracted so every password-login call site (the live
// client-side LoginForm.tsx, and both server actions in
// app/auth/actions.ts) applies the exact same distinction instead of
// each re-implementing its own isAuthRetryableFetchError check.
//
// Only two buckets are exposed on purpose. "connectivity" covers a
// genuine transient-fetch/service-unavailable failure (the auth service
// itself unreachable, e.g. the Cloudflare 522 outage #69A-19A traced) --
// the one case where telling the user "check your password" would be
// actively misleading. Every other signInWithPassword failure --
// genuinely wrong credentials, an unconfirmed email, an unexpected
// server error, anything else -- resolves to "credentials" and must
// keep showing the same generic message. Nothing here inspects or
// exposes *which* part of a login attempt was wrong (email vs.
// password vs. account state), since that would let an attacker
// enumerate a guessed credential pair one field at a time. Rate
// limiting is intentionally handled upstream of this classifier (via
// this app's own checkRateLimit, before signInWithPassword is ever
// called) and is not one of these buckets.
export type PasswordSignInErrorClassification = "connectivity" | "credentials";

export function classifyPasswordSignInError(
  error: unknown
): PasswordSignInErrorClassification {
  return isAuthRetryableFetchError(error) ? "connectivity" : "credentials";
}
