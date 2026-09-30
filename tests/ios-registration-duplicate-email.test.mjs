import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAlreadyRegisteredSignUp } from "@/app/lib/ios-attestation/signup-result.ts";

// THE CONFIRMED PRODUCTION DEFECT, reproduced from real Vercel logs:
//
//   [ios-registration] could not record provenance { reason: "User not found" }
//   [ios-attestation]  could not roll back a half-created account
//                      { userId: "128dacb4-...", reason: "User not found" }
//   -> HTTP 503 "Registration is not available."
//
// Both ids in those logs returned 404 from the Admin API and the project's
// user count never moved, because Supabase had returned a FABRICATED user for
// an address that was already registered. Registering with an address someone
// already holds is an ordinary outcome, not a server outage, and must be a
// 400 -- with a body that still reveals nothing about which addresses exist.

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("an already-registered address is recognised from the sign-up response", () => {
  // Supabase's documented signal: success-shaped, fabricated id, no identities.
  assert.equal(
    isAlreadyRegisteredSignUp({
      id: "128dacb4-cdc1-4cae-b05d-60f2bf41653b",
      email: "taken@example.com",
      identities: [],
    }),
    true
  );
});

test("a genuine new sign-up is not mistaken for a duplicate", () => {
  assert.equal(
    isAlreadyRegisteredSignUp({
      id: "00000000-0000-4000-8000-000000000001",
      identities: [{ id: "i1", provider: "email" }],
    }),
    false
  );
});

test("a missing identities field is treated as a real sign-up, not a duplicate", () => {
  // Deliberate asymmetry. Rejecting on a MISSING field would break genuine
  // registrations if Supabase ever stopped returning it; only an explicitly
  // empty array is the documented duplicate signal. Missing is ambiguous and
  // must not cost a legitimate user their registration.
  assert.equal(isAlreadyRegisteredSignUp({ id: "abc" }), false);
  assert.equal(isAlreadyRegisteredSignUp({ id: "abc", identities: null }), false);
  assert.equal(isAlreadyRegisteredSignUp({ id: "abc", identities: undefined }), false);
});

test("a missing user is not a duplicate", () => {
  assert.equal(isAlreadyRegisteredSignUp(null), false);
  assert.equal(isAlreadyRegisteredSignUp(undefined), false);
});

test("the route rejects a duplicate before it can touch the admin API", () => {
  // Ordering is the whole fix: the guard must run BEFORE
  // markAccountAsAppAttested, which is what failed with "User not found".
  const route = read("app/api/ios/registration/route.ts")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  const guard = route.indexOf("isAlreadyRegisteredSignUp(data.user)");
  const mark = route.indexOf("markAccountAsAppAttested(");
  const rollback = route.indexOf("deleteHalfProvisionedAccount(");

  assert.ok(guard > -1, "the duplicate guard must be present");
  assert.ok(guard < mark, "the guard must run before provenance is recorded");
  assert.ok(guard < rollback, "the guard must run before any rollback");
});

test("a duplicate returns 400 registration_failed, never 503", () => {
  const route = read("app/api/ios/registration/route.ts");
  const guardIndex = route.indexOf("isAlreadyRegisteredSignUp(data.user)");
  const branch = route.slice(guardIndex, guardIndex + 400);

  assert.match(branch, /status: 400/, "a duplicate must be a 400");
  assert.match(
    branch,
    /error: "registration_failed"/,
    "it must reuse the generic body so the endpoint stays a non-oracle"
  );
  assert.doesNotMatch(branch, /status: 503/);
  assert.doesNotMatch(
    branch,
    /Registration is not available/,
    "the 503 wording must not appear on the duplicate path"
  );
});

test("the response reveals nothing about which addresses exist", () => {
  // Every client-visible sign-up failure must be indistinguishable, so a
  // caller cannot use this endpoint to discover which addresses hold accounts.
  // Comments are stripped first: they necessarily discuss the very wording
  // under test.
  const route = read("app/api/ios/registration/route.ts")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");

  const bodies = [
    ...route.matchAll(/error: "([a-z_]+)"[\s\S]{0,60}?status: 400/g),
  ].map((m) => m[1]);

  assert.ok(
    bodies.includes("registration_failed"),
    "the duplicate and generic paths must both answer registration_failed"
  );
  assert.deepEqual(
    [...new Set(bodies)].sort(),
    ["invalid_email", "registration_failed", "weak_password"],
    "no 400 body may name a cause beyond the input the caller already knows"
  );
  // Checked against the RESPONSE BODIES specifically, not the whole file: an
  // identifier like isAlreadyRegisteredSignUp is internal and reveals nothing,
  // whereas a body saying so would.
  const responseBodies = [...route.matchAll(/error: "([^"]+)"/g)].map((m) => m[1]);
  for (const body of responseBodies) {
    assert.doesNotMatch(
      body,
      /already|taken|exists|registered|duplicate|in use/i,
      `response body ${JSON.stringify(body)} must not reveal whether an address exists`
    );
  }
});
