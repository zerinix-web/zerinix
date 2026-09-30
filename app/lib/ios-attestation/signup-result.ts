/**
 * Detects the response Supabase returns when the address is already
 * registered.
 *
 * WHY THIS IS NOT AN ERROR CHECK: with email confirmation enabled, GoTrue
 * deliberately does NOT report "this address already has an account" as an
 * error -- doing so would let anyone enumerate which addresses hold accounts.
 * It returns a success-shaped response instead, carrying a FABRICATED user id
 * and an empty `identities` array. No row is created.
 *
 * Acting on that fabricated id is what produced the confirmed production
 * failure: `auth.admin.updateUserById` answered "User not found", the rollback
 * that followed failed the same way, and the caller saw a 503 for what is an
 * ordinary "pick another address" outcome.
 *
 * ONLY AN EXPLICIT EMPTY ARRAY COUNTS. If `identities` is absent the result is
 * treated as a real sign-up, because rejecting on a missing field would break
 * genuine registrations should Supabase ever stop returning it. Missing is
 * ambiguous; empty is the documented signal.
 */
type SignUpUser = {
  identities?: unknown;
};

export function isAlreadyRegisteredSignUp(user: SignUpUser | null | undefined) {
  if (!user) {
    return false;
  }

  return Array.isArray(user.identities) && user.identities.length === 0;
}
