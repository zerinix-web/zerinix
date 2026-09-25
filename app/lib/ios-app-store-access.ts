/**
 * Product access for accounts created through the iOS App Store app.
 *
 * WHERE PROVENANCE LIVES, AND WHY IT MATTERS MORE THAN ANYTHING ELSE HERE:
 * `app_metadata` is writable only with the Supabase service-role key, through
 * `auth.admin.updateUserById`. `user_metadata` is writable by the user
 * themselves via `auth.updateUser({ data })`. Putting the marker in
 * user_metadata would let any signed-in account grant itself product access
 * with one client-side call -- a complete bypass of the private beta. It must
 * be app_metadata, and only the attested registration endpoint may set it.
 *
 * The marker is only ever written after this server has verified an Apple App
 * Attest assertion against Apple's pinned root CA, so it records something the
 * server proved rather than something a client claimed.
 */

export const IOS_APP_ATTEST_REGISTRATION_SOURCE = "ios_app_attest";

type AttestedAccount = {
  app_metadata?: Record<string, unknown> | null;
};

export function isAppAttestedAccount(account?: AttestedAccount | null) {
  if (!account) {
    return false;
  }

  const source = account.app_metadata?.registration_source;

  return (
    typeof source === "string" &&
    source.trim() === IOS_APP_ATTEST_REGISTRATION_SOURCE
  );
}
