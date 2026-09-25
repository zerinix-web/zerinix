import "server-only";

// App Attest needs two identifiers that only the deployment knows: the Apple
// team and the bundle identifier the app was signed with. They are hashed
// into every attestation, so getting them wrong does not weaken anything --
// verification simply fails.
//
// THIS IS ALSO THE FEATURE SWITCH. When either value is missing, iOS
// self-service registration is unavailable and every endpoint below refuses
// the request. That is deliberate: the safe state is "off", and it is the
// state of every environment that has not deliberately configured this,
// including today's production. There is no boolean to forget to set.

export type AppAttestConfig = {
  teamId: string;
  bundleId: string;
  /**
   * Debug builds attest with a different AAGUID, and anybody can run a debug
   * build on their own device. Accepting one in production would hand the
   * attacker the very capability attestation exists to deny, so this defaults
   * to false and must be turned on explicitly, per environment.
   */
  allowDevelopmentAttestation: boolean;
};

const readEnv = (name: string) => (process.env[name] || "").trim();

export function getAppAttestConfig(): AppAttestConfig | null {
  const teamId = readEnv("APPLE_TEAM_ID");
  const bundleId = readEnv("IOS_APP_BUNDLE_ID");

  if (!teamId || !bundleId) {
    return null;
  }

  return {
    teamId,
    bundleId,
    allowDevelopmentAttestation:
      readEnv("IOS_APP_ATTEST_ALLOW_DEVELOPMENT").toLowerCase() === "true",
  };
}

export function isIosSelfServeRegistrationEnabled() {
  return getAppAttestConfig() !== null;
}
